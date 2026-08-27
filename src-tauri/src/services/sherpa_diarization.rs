#[cfg(any(target_os = "windows", target_os = "android"))]
mod windows {
    use crate::services::speech_model_repository::ResolvedDiarizationModel;
    use std::collections::{BTreeMap, BTreeSet};
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

    pub fn process(
        runtime_path: &Path,
        model: &ResolvedDiarizationModel,
        samples: &[f32],
    ) -> Result<DiarizationResult, String> {
        if samples.is_empty() {
            return Ok(DiarizationResult {
                speaker_count: 0,
                segments: Vec::new(),
            });
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
                // Sherpa uses a distance threshold: larger values merge more
                // embeddings. 0.5 over-segments normal meeting audio and tends
                // to turn channel/noise variation into phantom speakers.
                threshold: 0.9,
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
        let speaker_count = checked_count(
            unsafe { (api.num_speakers)(result_guard.value.as_ptr()) },
            100,
            "speakers",
        )? as u32;
        let segment_count = checked_count(
            unsafe { (api.num_segments)(result_guard.value.as_ptr()) },
            100_000,
            "segmentos",
        )?;
        if segment_count == 0 {
            return Ok(DiarizationResult {
                speaker_count,
                segments: Vec::new(),
            });
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
        let segments =
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
                .collect::<Result<Vec<_>, _>>()?;
        let _reported_speaker_count = speaker_count;
        Ok(stabilize_speakers(segments))
    }

    fn stabilize_speakers(mut segments: Vec<DiarizationSegment>) -> DiarizationResult {
        const MIN_SPEAKER_EVIDENCE_SECONDS: f32 = 1.5;
        const MIN_SPEAKER_SHARE: f32 = 0.04;
        const MIN_RECORDING_FOR_EVIDENCE_FILTER_SECONDS: f32 = 10.0;

        let mut durations = BTreeMap::<i32, f32>::new();
        for segment in &segments {
            *durations.entry(segment.speaker).or_default() +=
                (segment.end_seconds - segment.start_seconds).max(0.0);
        }
        let total_duration = durations.values().sum::<f32>();
        let weak_speakers = durations
            .iter()
            .filter_map(|(&speaker, &duration)| {
                let too_short = total_duration >= MIN_RECORDING_FOR_EVIDENCE_FILTER_SECONDS
                    && duration < MIN_SPEAKER_EVIDENCE_SECONDS;
                let too_rare =
                    total_duration > 0.0 && duration / total_duration < MIN_SPEAKER_SHARE;
                (too_short || too_rare).then_some(speaker)
            })
            .collect::<BTreeSet<_>>();

        for index in 0..segments.len() {
            if !weak_speakers.contains(&segments[index].speaker) {
                continue;
            }
            let previous = segments[..index]
                .iter()
                .rev()
                .find(|segment| !weak_speakers.contains(&segment.speaker));
            let next = segments[index + 1..]
                .iter()
                .find(|segment| !weak_speakers.contains(&segment.speaker));
            let replacement = match (previous, next) {
                (Some(previous), Some(next)) if previous.speaker == next.speaker => {
                    Some(previous.speaker)
                }
                (Some(previous), Some(next)) => {
                    let previous_gap = (segments[index].start_seconds - previous.end_seconds).abs();
                    let next_gap = (next.start_seconds - segments[index].end_seconds).abs();
                    Some(if previous_gap <= next_gap {
                        previous.speaker
                    } else {
                        next.speaker
                    })
                }
                (Some(previous), None) => Some(previous.speaker),
                (None, Some(next)) => Some(next.speaker),
                (None, None) => None,
            };
            if let Some(speaker) = replacement {
                segments[index].speaker = speaker;
            }
        }

        let speaker_ids = segments
            .iter()
            .map(|segment| segment.speaker)
            .collect::<BTreeSet<_>>();
        let normalized_ids = speaker_ids
            .into_iter()
            .enumerate()
            .map(|(normalized, original)| (original, normalized as i32))
            .collect::<BTreeMap<_, _>>();
        for segment in &mut segments {
            if let Some(&normalized) = normalized_ids.get(&segment.speaker) {
                segment.speaker = normalized;
            }
        }
        DiarizationResult {
            speaker_count: normalized_ids.len() as u32,
            segments,
        }
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
        num_speakers: Count,
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
                num_speakers: symbol!(
                    b"SherpaOnnxOfflineSpeakerDiarizationResultGetNumSpeakers\0",
                    Count
                ),
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
        use super::{stabilize_speakers, DiarizationSegment, OfflineSpeakerDiarizationConfig};

        #[test]
        fn c_struct_layout_matches_sherpa_onnx_1_13_4() {
            assert_eq!(std::mem::size_of::<OfflineSpeakerDiarizationConfig>(), 64);
        }

        #[test]
        fn removes_a_short_phantom_speaker_between_interview_speakers() {
            let result = stabilize_speakers(vec![
                DiarizationSegment {
                    start_seconds: 0.0,
                    end_seconds: 8.0,
                    speaker: 0,
                },
                DiarizationSegment {
                    start_seconds: 8.0,
                    end_seconds: 18.0,
                    speaker: 1,
                },
                DiarizationSegment {
                    start_seconds: 18.0,
                    end_seconds: 18.7,
                    speaker: 2,
                },
                DiarizationSegment {
                    start_seconds: 18.7,
                    end_seconds: 30.0,
                    speaker: 1,
                },
            ]);
            assert_eq!(result.speaker_count, 2);
            assert_eq!(result.segments[2].speaker, 1);
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "android"))]
pub use windows::{process, DiarizationResult, DiarizationSegment};
