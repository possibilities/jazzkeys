fn main() {
    // No command-line switches can select a device, arbitrary executable, or fake capability.
    if std::env::args_os().len() != 1 {
        eprintln!("jazzkeys-device accepts intent messages on private stdin only");
        std::process::exit(2);
    }
    if jazzkeys_device::run(std::io::stdin().lock(), std::io::stdout().lock()).is_err() {
        eprintln!("jazzkeys-device: private pipe closed or failed");
        std::process::exit(1);
    }
}
