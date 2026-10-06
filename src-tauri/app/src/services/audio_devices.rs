//! The microphones and outputs of this computer and the ones a recording
//! captures: the person's choice from the device preferences
//! (`audioDevices`) while the device is connected, otherwise the system
//! default. Devices are known by name, the name Windows shows. Only Windows
//! lets the person choose; elsewhere the default is used.

use notia_backend_core::audio_devices::{connected_choice, device_list, AudioDevicesDto};

use crate::host::AppHandle;

/// The devices a capture opens; `None` opens the system default.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CaptureDevices {
    pub microphone: Option<String>,
    pub output: Option<String>,
}

/// Names of the connected devices and of the default one.
struct DeviceNames {
    names: Vec<String>,
    default: Option<String>,
}

#[cfg(target_os = "windows")]
fn names(inputs: bool) -> DeviceNames {
    use cpal::traits::{DeviceTrait, HostTrait};
    let host = cpal::default_host();
    let devices = if inputs { host.input_devices() } else { host.output_devices() };
    let mut names: Vec<String> = devices
        .map(|devices| devices.filter_map(|device| device.name().ok()).filter(|name| !name.trim().is_empty()).collect())
        .unwrap_or_default();
    // Two monitors may share a name; the first of them is the one opened.
    let mut seen = std::collections::HashSet::new();
    names.retain(|name| seen.insert(name.clone()));
    let default = if inputs { host.default_input_device() } else { host.default_output_device() }.and_then(|device| device.name().ok());
    DeviceNames { names, default }
}

#[cfg(not(target_os = "windows"))]
fn names(_inputs: bool) -> DeviceNames {
    DeviceNames { names: Vec::new(), default: None }
}

/// What the person chose, as stored.
fn stored_choice(app: &AppHandle) -> (Option<String>, Option<String>) {
    let section = crate::device_preferences::section(app, "audioDevices");
    let text = |key: &str| section[key].as_str().map(str::to_string);
    (text("microphone"), text("output"))
}

/// The devices of this computer and the ones chosen, for the recording setup.
pub fn list(app: &AppHandle) -> AudioDevicesDto {
    let microphones = names(true);
    let outputs = names(false);
    let (microphone, output) = stored_choice(app);
    AudioDevicesDto {
        supported: cfg!(target_os = "windows"),
        microphone: connected_choice(microphone.as_deref(), &microphones.names),
        output: connected_choice(output.as_deref(), &outputs.names),
        microphones: device_list(&microphones.names, microphones.default.as_deref()),
        outputs: device_list(&outputs.names, outputs.default.as_deref()),
    }
}

#[cfg(all(test, target_os = "windows"))]
mod native_smoke_tests {
    use super::names;
    use crate::services::audio_devices::CaptureDevices;
    use crate::services::speech_audio::{CaptureSources, PlatformAudioCapture};

    /// Lists this computer's devices and opens every non-virtual microphone
    /// and output by name for a second, as a recording would.
    #[test]
    #[ignore = "opens this computer's audio devices"]
    fn opens_the_devices_of_this_computer_by_name() {
        let microphones = names(true);
        let outputs = names(false);
        eprintln!("microphones {:?} default {:?}", microphones.names, microphones.default);
        eprintln!("outputs {:?} default {:?}", outputs.names, outputs.default);
        let pick = |list: &[String]| list.iter().find(|name| !notia_backend_core::audio_devices::is_virtual_device(name)).cloned();
        let devices = CaptureDevices { microphone: pick(&microphones.names), output: pick(&outputs.names) };
        let sources = CaptureSources { microphone: devices.microphone.is_some(), system: devices.output.is_some() };
        let meter = std::sync::Arc::new(crate::services::speech_audio::CaptureMeter::default());
        let capture = PlatformAudioCapture::start(None, sources, Some(std::sync::Arc::clone(&meter)), &devices).expect("open the chosen devices");
        std::thread::sleep(std::time::Duration::from_secs(1));
        drop(capture);
        eprintln!("opened {devices:?}");
    }
}

/// The devices a capture opens now.
pub fn for_capture(app: &AppHandle) -> CaptureDevices {
    if !cfg!(target_os = "windows") {
        return CaptureDevices::default();
    }
    let (microphone, output) = stored_choice(app);
    CaptureDevices {
        microphone: microphone.and_then(|name| connected_choice(Some(&name), &names(true).names)),
        output: output.and_then(|name| connected_choice(Some(&name), &names(false).names)),
    }
}
