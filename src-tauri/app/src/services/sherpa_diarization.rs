#[cfg(any(target_os = "windows", target_os = "android"))]
mod windows {
    use crate::services::speech_model_repository::ResolvedDiarizationModel;
    use notia_backend_core::speaker_clustering::{cluster_speakers, ClusteringOptions, SpeakerPiece};
    use std::collections::BTreeSet;
    use std::ffi::{c_char, c_void, CString};
    use std::path::Path;
    use std::ptr::NonNull;

    #[derive(Debug, Clone, PartialEq)]
    pub struct DiarizationSegment {
        pub start_seconds: f32,
        pub end_seconds: f32,
        pub speaker: i32,
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct DiarizationResult {
        pub speaker_count: u32,
        pub segments: Vec<DiarizationSegment>,
    }

    #[derive(Debug, Clone, PartialEq)]
    pub struct SpeakerEmbedding {
        pub speaker: i32,
        pub vector: Vec<f32>,
    }

    const MIN_EMBEDDING_SAMPLES: usize = 16_000;
    const MAX_EMBEDDING_SAMPLES: usize = 16_000 * 60;
    /// Distance threshold of sherpa's own clustering, used only to cut the
    /// audio: low enough that two speakers are never joined into one piece.
    const SEGMENTER_THRESHOLD: f32 = 0.5;

    /// Separates the speakers of `samples`. sherpa-onnx (pyannote
    /// segmentation) cuts the audio where the speaker changes; each piece
    /// gets its own voice embedding and `speaker_clustering` decides who is
    /// who, exactly `expected_speakers` when the person said how many. The
    /// diarizer's own clustering split one person into several and joined
    /// others on Spanish calls.
    pub fn process(
        runtime_path: &Path,
        model: &ResolvedDiarizationModel,
        samples: &[f32],
        expected_speakers: Option<u32>,
    ) -> Result<DiarizationResult, String> {
        let pieces = cut_pieces(runtime_path, model, samples)?;
        if pieces.is_empty() {
            return Ok(DiarizationResult { speaker_count: 0, segments: Vec::new() });
        }
        let extractor = SpeakerEmbeddingExtractor::new(runtime_path, model)?;
        let embedded = pieces
            .iter()
            .map(|piece| {
                Ok(SpeakerPiece {
                    start_seconds: piece.start_seconds,
                    end_seconds: piece.end_seconds,
                    embedding: extractor.embed(samples, piece)?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        let options = ClusteringOptions::for_pieces(
            &embedded,
            model.clustering_threshold,
            expected_speakers.map(|count| count as usize),
        );
        let labels = cluster_speakers(&embedded, options);
        let speaker_count = labels.iter().copied().max().map_or(0, |last| last as u32 + 1);
        let segments = pieces
            .into_iter()
            .zip(labels)
            .map(|(piece, label)| DiarizationSegment { speaker: label as i32, ..piece })
            .collect();
        Ok(DiarizationResult { speaker_count, segments })
    }

    /// Where the speaker changes in `samples`: the pieces of sherpa-onnx's
    /// diarization, whose labels are discarded.
    fn cut_pieces(
        runtime_path: &Path,
        model: &ResolvedDiarizationModel,
        samples: &[f32],
    ) -> Result<Vec<DiarizationSegment>, String> {
        if samples.is_empty() {
            return Ok(Vec::new());
        }
        if samples.len() > i32::MAX as usize || !(1..=8).contains(&model.num_threads) {
            return Err("La entrada de diarizacion excede los limites permitidos.".to_string());
        }
        let segmentation = path_string(&model.segmentation, "segmentacion")?;
        let embedding = path_string(&model.embedding, "embedding")?;
        let provider = CString::new("cpu").map_err(|_| "Provider invalido.".to_string())?;
        let config = OfflineSpeakerDiarizationConfig {
            segmentation: OfflineSpeakerSegmentationModelConfig {
                pyannote: SingleModelConfig {
                    model: segmentation.as_ptr(),
                },
                num_threads: model.num_threads,
                debug: 0,
                provider: provider.as_ptr(),
            },
            embedding: SpeakerEmbeddingExtractorConfig {
                model: embedding.as_ptr(),
                num_threads: model.num_threads,
                debug: 0,
                provider: provider.as_ptr(),
            },
            clustering: FastClusteringConfig {
                num_clusters: 0,
                threshold: SEGMENTER_THRESHOLD,
            },
            min_duration_on: 0.5,
            min_duration_off: 0.3,
        };
        let api = unsafe { DiarizationApi::load(runtime_path) }?;
        let diarizer = NonNull::new(unsafe { (api.create)(&config) } as *mut c_void)
            .ok_or_else(|| "sherpa-onnx no pudo crear el diarizador.".to_string())?;
        let diarizer_guard = DiarizerGuard {
            value: diarizer,
            destroy: api.destroy,
        };
        let sample_rate = unsafe { (api.sample_rate)(diarizer_guard.value.as_ptr()) };
        if sample_rate != 16_000 {
            return Err(format!(
                "El modelo de diarizacion requiere una frecuencia no soportada: {sample_rate}."
            ));
        }
        let result = NonNull::new(unsafe {
            (api.process)(
                diarizer_guard.value.as_ptr(),
                samples.as_ptr(),
                samples.len() as i32,
            )
        } as *mut c_void)
        .ok_or_else(|| "sherpa-onnx no pudo diarizar el audio.".to_string())?;
        let result_guard = ResultGuard {
            value: result,
            destroy: api.destroy_result,
        };
        let segment_count = checked_count(
            unsafe { (api.num_segments)(result_guard.value.as_ptr()) },
            100_000,
            "segmentos",
        )?;
        if segment_count == 0 {
            return Ok(Vec::new());
        }
        let segments = NonNull::new(
            unsafe { (api.sorted_segments)(result_guard.value.as_ptr()) }
                as *mut OfflineSpeakerDiarizationSegment,
        )
        .ok_or_else(|| "sherpa-onnx devolvio segmentos nulos.".to_string())?;
        let segment_guard = SegmentGuard {
            value: segments,
            destroy: api.destroy_segments,
        };
        unsafe { std::slice::from_raw_parts(segment_guard.value.as_ptr(), segment_count) }
                .iter()
                .map(|segment| {
                    if !segment.start.is_finite()
                        || !segment.end.is_finite()
                        || segment.start < 0.0
                        || segment.end < segment.start
                        || segment.speaker < 0
                    {
                        return Err(
                            "sherpa-onnx devolvio un segmento de speaker invalido.".to_string()
                        );
                    }
                    Ok(DiarizationSegment {
                        start_seconds: segment.start,
                        end_seconds: segment.end,
                        speaker: segment.speaker,
                    })
                })
                .collect::<Result<Vec<_>, _>>()
    }

    pub struct SpeakerEmbeddingExtractor {
        extractor: EmbeddingExtractorGuard,
        api: EmbeddingApi,
        dimension: usize,
    }

    impl SpeakerEmbeddingExtractor {
        pub fn new(runtime_path: &Path, model: &ResolvedDiarizationModel) -> Result<Self, String> {
            if !(1..=8).contains(&model.num_threads) {
                return Err("El extractor de embeddings excede los limites permitidos.".to_string());
            }
            let api = unsafe { EmbeddingApi::load(runtime_path) }?;
            let model_path = path_string(&model.embedding, "embedding")?;
            let provider = CString::new("cpu").map_err(|_| "Provider invalido.".to_string())?;
            let config = EmbeddingExtractorConfig {
                model: model_path.as_ptr(),
                num_threads: model.num_threads,
                debug: 0,
                provider: provider.as_ptr(),
            };
            let extractor = NonNull::new(unsafe { (api.create)(&config) } as *mut c_void)
                .ok_or_else(|| {
                    "sherpa-onnx no pudo crear el extractor de embeddings.".to_string()
                })?;
            let extractor_guard = EmbeddingExtractorGuard {
                value: extractor,
                destroy: api.destroy,
            };
            let dimension = checked_count(
                unsafe { (api.dimension)(extractor_guard.value.as_ptr()) },
                4_096,
                "dimensiones de embedding",
            )?;
            if dimension == 0 {
                return Err("sherpa-onnx devolvio una dimension de embedding invalida.".to_string());
            }
            Ok(Self {
                extractor: extractor_guard,
                api,
                dimension,
            })
        }

        /// The voice embedding of one piece; `None` when it is too short.
        pub fn embed(&self, samples: &[f32], piece: &DiarizationSegment) -> Result<Option<Vec<f32>>, String> {
            let one = DiarizationResult {
                speaker_count: 1,
                segments: vec![DiarizationSegment { speaker: 0, ..piece.clone() }],
            };
            self.extract_for_speaker(samples, &one, 0)
        }

        pub fn extract(
            &self,
            samples: &[f32],
            diarization: &DiarizationResult,
        ) -> Result<Vec<SpeakerEmbedding>, String> {
            let speakers = diarization
                .segments
                .iter()
                .map(|segment| segment.speaker)
                .collect::<BTreeSet<_>>();
            let mut embeddings = Vec::with_capacity(speakers.len());
            for speaker in speakers {
                if let Some(vector) = self.extract_for_speaker(samples, diarization, speaker)? {
                    embeddings.push(SpeakerEmbedding { speaker, vector });
                }
            }
            Ok(embeddings)
        }

        fn extract_for_speaker(
            &self,
            samples: &[f32],
            diarization: &DiarizationResult,
            speaker: i32,
        ) -> Result<Option<Vec<f32>>, String> {
            let stream =
                NonNull::new(
                    unsafe { (self.api.create_stream)(self.extractor.value.as_ptr()) }
                        as *mut c_void,
                )
                .ok_or_else(|| "sherpa-onnx no pudo crear el stream de embedding.".to_string())?;
            let stream_guard = EmbeddingStreamGuard {
                value: stream,
                destroy: self.api.destroy_stream,
            };
            let mut accepted_samples = 0_usize;
            for segment in diarization
                .segments
                .iter()
                .filter(|segment| segment.speaker == speaker)
            {
                let Some((start, end)) = sample_bounds(segment, samples.len()) else {
                    continue;
                };
                let remaining = MAX_EMBEDDING_SAMPLES.saturating_sub(accepted_samples);
                let count = (end - start).min(remaining);
                if count == 0 {
                    break;
                }
                unsafe {
                    (self.api.accept_waveform)(
                        stream_guard.value.as_ptr(),
                        16_000,
                        samples[start..start + count].as_ptr(),
                        count as i32,
                    );
                }
                accepted_samples += count;
            }
            if accepted_samples < MIN_EMBEDDING_SAMPLES {
                return Ok(None);
            }
            unsafe { (self.api.input_finished)(stream_guard.value.as_ptr()) };
            if unsafe {
                (self.api.is_ready)(self.extractor.value.as_ptr(), stream_guard.value.as_ptr())
            } == 0
            {
                return Ok(None);
            }
            let embedding = NonNull::new(unsafe {
                (self.api.compute)(self.extractor.value.as_ptr(), stream_guard.value.as_ptr())
                    as *mut f32
            })
            .ok_or_else(|| "sherpa-onnx no pudo calcular el embedding.".to_string())?;
            let vector =
                unsafe { std::slice::from_raw_parts(embedding.as_ptr(), self.dimension).to_vec() };
            unsafe { (self.api.destroy_embedding)(embedding.as_ptr()) };
            if !vector.iter().all(|value| value.is_finite())
                || vector.iter().map(|value| value * value).sum::<f32>() <= f32::EPSILON
            {
                return Err("sherpa-onnx devolvio un embedding invalido.".to_string());
            }
            Ok(Some(vector))
        }
    }

    fn sample_bounds(segment: &DiarizationSegment, sample_count: usize) -> Option<(usize, usize)> {
        if !segment.start_seconds.is_finite()
            || !segment.end_seconds.is_finite()
            || segment.start_seconds < 0.0
            || segment.end_seconds <= segment.start_seconds
        {
            return None;
        }
        let start = (f64::from(segment.start_seconds) * 16_000.0)
            .floor()
            .clamp(0.0, sample_count as f64) as usize;
        let end = (f64::from(segment.end_seconds) * 16_000.0)
            .ceil()
            .clamp(0.0, sample_count as f64) as usize;
        (end > start).then_some((start, end))
    }

    struct EmbeddingApi {
        _library: crate::services::sherpa_runtime::LoadedSherpaLibrary,
        create: CreateEmbeddingExtractor,
        destroy: Destroy,
        dimension: EmbeddingDimension,
        create_stream: CreateEmbeddingStream,
        destroy_stream: Destroy,
        accept_waveform: AcceptWaveform,
        input_finished: InputFinished,
        is_ready: IsEmbeddingReady,
        compute: ComputeEmbedding,
        destroy_embedding: DestroyEmbedding,
    }

    impl EmbeddingApi {
        unsafe fn load(runtime_path: &Path) -> Result<Self, String> {
            let library = unsafe {
                crate::services::sherpa_runtime::LoadedSherpaLibrary::load(runtime_path)
            }?;
            macro_rules! symbol {
                ($name:literal, $type:ty) => {{
                    let symbol: libloading::Symbol<'_, $type> = unsafe { library.get($name) }
                        .map_err(|error| format!("Falta un simbolo de embedding: {error}"))?;
                    *symbol
                }};
            }
            Ok(Self {
                create: symbol!(
                    b"SherpaOnnxCreateSpeakerEmbeddingExtractor\0",
                    CreateEmbeddingExtractor
                ),
                destroy: symbol!(b"SherpaOnnxDestroySpeakerEmbeddingExtractor\0", Destroy),
                dimension: symbol!(
                    b"SherpaOnnxSpeakerEmbeddingExtractorDim\0",
                    EmbeddingDimension
                ),
                create_stream: symbol!(
                    b"SherpaOnnxSpeakerEmbeddingExtractorCreateStream\0",
                    CreateEmbeddingStream
                ),
                destroy_stream: symbol!(b"SherpaOnnxDestroyOnlineStream\0", Destroy),
                accept_waveform: symbol!(b"SherpaOnnxOnlineStreamAcceptWaveform\0", AcceptWaveform),
                input_finished: symbol!(b"SherpaOnnxOnlineStreamInputFinished\0", InputFinished),
                is_ready: symbol!(
                    b"SherpaOnnxSpeakerEmbeddingExtractorIsReady\0",
                    IsEmbeddingReady
                ),
                compute: symbol!(
                    b"SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding\0",
                    ComputeEmbedding
                ),
                destroy_embedding: symbol!(
                    b"SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding\0",
                    DestroyEmbedding
                ),
                _library: library,
            })
        }
    }

    struct EmbeddingExtractorGuard {
        value: NonNull<c_void>,
        destroy: Destroy,
    }

    impl Drop for EmbeddingExtractorGuard {
        fn drop(&mut self) {
            unsafe { (self.destroy)(self.value.as_ptr()) };
        }
    }

    struct EmbeddingStreamGuard {
        value: NonNull<c_void>,
        destroy: Destroy,
    }

    impl Drop for EmbeddingStreamGuard {
        fn drop(&mut self) {
            unsafe { (self.destroy)(self.value.as_ptr()) };
        }
    }

    type CreateEmbeddingExtractor =
        unsafe extern "C" fn(*const EmbeddingExtractorConfig) -> *const c_void;
    type EmbeddingDimension = unsafe extern "C" fn(*const c_void) -> i32;
    type CreateEmbeddingStream = unsafe extern "C" fn(*const c_void) -> *const c_void;
    type AcceptWaveform = unsafe extern "C" fn(*const c_void, i32, *const f32, i32);
    type InputFinished = unsafe extern "C" fn(*const c_void);
    type IsEmbeddingReady = unsafe extern "C" fn(*const c_void, *const c_void) -> i32;
    type ComputeEmbedding = unsafe extern "C" fn(*const c_void, *const c_void) -> *const f32;
    type DestroyEmbedding = unsafe extern "C" fn(*const f32);

    #[repr(C)]
    struct EmbeddingExtractorConfig {
        model: *const c_char,
        num_threads: i32,
        debug: i32,
        provider: *const c_char,
    }

    fn path_string(path: &Path, label: &str) -> Result<CString, String> {
        if !path.is_absolute() || !path.is_file() {
            return Err(format!("El modelo de {label} no es valido."));
        }
        CString::new(
            path.to_str()
                .ok_or_else(|| format!("La ruta de {label} no es UTF-8."))?,
        )
        .map_err(|_| format!("La ruta de {label} contiene un byte nulo."))
    }

    fn checked_count(value: i32, maximum: usize, label: &str) -> Result<usize, String> {
        let value = usize::try_from(value)
            .map_err(|_| format!("sherpa-onnx devolvio una cantidad de {label} invalida."))?;
        if value > maximum {
            return Err(format!("sherpa-onnx devolvio demasiados {label}."));
        }
        Ok(value)
    }

    #[repr(C)]
    struct SingleModelConfig {
        model: *const c_char,
    }

    #[repr(C)]
    struct OfflineSpeakerSegmentationModelConfig {
        pyannote: SingleModelConfig,
        num_threads: i32,
        debug: i32,
        provider: *const c_char,
    }

    #[repr(C)]
    struct SpeakerEmbeddingExtractorConfig {
        model: *const c_char,
        num_threads: i32,
        debug: i32,
        provider: *const c_char,
    }

    #[repr(C)]
    struct FastClusteringConfig {
        num_clusters: i32,
        threshold: f32,
    }

    #[repr(C)]
    struct OfflineSpeakerDiarizationConfig {
        segmentation: OfflineSpeakerSegmentationModelConfig,
        embedding: SpeakerEmbeddingExtractorConfig,
        clustering: FastClusteringConfig,
        min_duration_on: f32,
        min_duration_off: f32,
    }

    #[repr(C)]
    struct OfflineSpeakerDiarizationSegment {
        start: f32,
        end: f32,
        speaker: i32,
    }

    type Create = unsafe extern "C" fn(*const OfflineSpeakerDiarizationConfig) -> *const c_void;
    type Destroy = unsafe extern "C" fn(*const c_void);
    type SampleRate = unsafe extern "C" fn(*const c_void) -> i32;
    type Process = unsafe extern "C" fn(*const c_void, *const f32, i32) -> *const c_void;
    type Count = unsafe extern "C" fn(*const c_void) -> i32;
    type Sorted = unsafe extern "C" fn(*const c_void) -> *const OfflineSpeakerDiarizationSegment;
    type DestroySegments = unsafe extern "C" fn(*const OfflineSpeakerDiarizationSegment);

    struct DiarizationApi {
        _library: crate::services::sherpa_runtime::LoadedSherpaLibrary,
        create: Create,
        destroy: Destroy,
        sample_rate: SampleRate,
        process: Process,
        num_segments: Count,
        sorted_segments: Sorted,
        destroy_segments: DestroySegments,
        destroy_result: Destroy,
    }

    impl DiarizationApi {
        unsafe fn load(path: &Path) -> Result<Self, String> {
            let library =
                unsafe { crate::services::sherpa_runtime::LoadedSherpaLibrary::load(path) }?;
            macro_rules! symbol {
                ($name:literal, $type:ty) => {{
                    let symbol: libloading::Symbol<'_, $type> = unsafe { library.get($name) }
                        .map_err(|error| format!("Falta un simbolo de diarizacion: {error}"))?;
                    *symbol
                }};
            }
            Ok(Self {
                create: symbol!(b"SherpaOnnxCreateOfflineSpeakerDiarization\0", Create),
                destroy: symbol!(b"SherpaOnnxDestroyOfflineSpeakerDiarization\0", Destroy),
                sample_rate: symbol!(
                    b"SherpaOnnxOfflineSpeakerDiarizationGetSampleRate\0",
                    SampleRate
                ),
                process: symbol!(b"SherpaOnnxOfflineSpeakerDiarizationProcess\0", Process),
                num_segments: symbol!(
                    b"SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments\0",
                    Count
                ),
                sorted_segments: symbol!(
                    b"SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime\0",
                    Sorted
                ),
                destroy_segments: symbol!(
                    b"SherpaOnnxOfflineSpeakerDiarizationDestroySegment\0",
                    DestroySegments
                ),
                destroy_result: symbol!(
                    b"SherpaOnnxOfflineSpeakerDiarizationDestroyResult\0",
                    Destroy
                ),
                _library: library,
            })
        }
    }

    struct DiarizerGuard {
        value: NonNull<c_void>,
        destroy: Destroy,
    }
    impl Drop for DiarizerGuard {
        fn drop(&mut self) {
            unsafe { (self.destroy)(self.value.as_ptr()) };
        }
    }

    struct ResultGuard {
        value: NonNull<c_void>,
        destroy: Destroy,
    }
    impl Drop for ResultGuard {
        fn drop(&mut self) {
            unsafe { (self.destroy)(self.value.as_ptr()) };
        }
    }

    struct SegmentGuard {
        value: NonNull<OfflineSpeakerDiarizationSegment>,
        destroy: DestroySegments,
    }
    impl Drop for SegmentGuard {
        fn drop(&mut self) {
            unsafe { (self.destroy)(self.value.as_ptr()) };
        }
    }

    #[cfg(test)]
    mod tests {
        use super::OfflineSpeakerDiarizationConfig;

        #[test]
        fn c_struct_layout_matches_sherpa_onnx_1_13_4() {
            assert_eq!(std::mem::size_of::<OfflineSpeakerDiarizationConfig>(), 64);
        }

        /// Diarizes every 16 kHz mono WAV of `NOTIA_DIAR_PROBE_DIR` with the
        /// packaged segmentation, the embedding `NOTIA_DIAR_EMBEDDING` (the
        /// packaged one by default) and each threshold of
        /// `NOTIA_DIAR_THRESHOLDS` (comma separated), and writes
        /// `<name>.<NOTIA_DIAR_LABEL>-<threshold>.diar.txt` (`start end speaker`).
        /// With `NOTIA_DIAR_EXPECTED` it also clusters into the number in
        /// `<name>.speakers.txt` (written as threshold `k`).
        #[cfg(target_os = "windows")]
        #[test]
        #[ignore = "requires NOTIA_DIAR_PROBE_DIR and the packaged diarization models"]
        fn diarizes_probe_recordings() {
            use crate::services::speech_model_repository::{ResolvedDiarizationModel, DIARIZATION_CLUSTERING_THRESHOLD};
            use std::path::PathBuf;
            let Ok(dir) = std::env::var("NOTIA_DIAR_PROBE_DIR") else {
                return;
            };
            let root = PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/.."));
            let models = root.join("resources/speech/models/speaker-diarization-v2");
            let runtime = root.join("resources/speech/runtime/windows-x86_64/sherpa-onnx-c-api.dll");
            let embedding = std::env::var("NOTIA_DIAR_EMBEDDING").map_or(models.join("embedding.onnx"), PathBuf::from);
            let label = std::env::var("NOTIA_DIAR_LABEL").unwrap_or_else(|_| "current".into());
            let thresholds: Vec<f32> = std::env::var("NOTIA_DIAR_THRESHOLDS")
                .map(|list| list.split(',').filter_map(|value| value.trim().parse().ok()).collect())
                .unwrap_or_else(|_| vec![DIARIZATION_CLUSTERING_THRESHOLD]);
            let expected = std::env::var("NOTIA_DIAR_EXPECTED").is_ok();
            let mut wavs = std::fs::read_dir(&dir)
                .expect("probe dir")
                .filter_map(|entry| entry.ok().map(|entry| entry.path()))
                .filter(|path| path.extension().is_some_and(|extension| extension == "wav"))
                .collect::<Vec<_>>();
            wavs.sort();
            for wav in wavs {
                let samples = hound::WavReader::open(&wav)
                    .expect("wav")
                    .into_samples::<i16>()
                    .map(|sample| f32::from(sample.expect("sample")) / f32::from(i16::MAX))
                    .collect::<Vec<_>>();
                let mut runs: Vec<(String, f32, Option<u32>)> =
                    thresholds.iter().map(|threshold| (format!("{threshold}"), *threshold, None)).collect();
                if expected {
                    let count = std::fs::read_to_string(wav.with_extension("speakers.txt"))
                        .ok()
                        .and_then(|text| text.trim().parse().ok());
                    if let Some(count) = count {
                        runs.push(("k".into(), DIARIZATION_CLUSTERING_THRESHOLD, Some(count)));
                    }
                }
                for (name, threshold, count) in runs {
                    let model = ResolvedDiarizationModel {
                        segmentation: models.join("segmentation.onnx"),
                        embedding: embedding.clone(),
                        num_threads: 4,
                        clustering_threshold: threshold,
                    };
                    let started = std::time::Instant::now();
                    let result = super::process(&runtime, &model, &samples, count).expect("diarize");
                    let lines = result
                        .segments
                        .iter()
                        .map(|segment| format!("{:.2} {:.2} {}", segment.start_seconds, segment.end_seconds, segment.speaker))
                        .collect::<Vec<_>>();
                    let stem = wav.file_stem().and_then(|stem| stem.to_str()).unwrap_or_default().to_string();
                    std::fs::write(wav.with_file_name(format!("{stem}.{label}-{name}.diar.txt")), lines.join("\n")).expect("write");
                    eprintln!("{stem} {label}-{name}: {} speakers in {:.1} s", result.speaker_count, started.elapsed().as_secs_f32());
                }
            }
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub use windows::{
    process, DiarizationResult, DiarizationSegment, SpeakerEmbedding, SpeakerEmbeddingExtractor,
};
