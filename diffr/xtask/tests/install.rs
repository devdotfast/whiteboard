use std::process::Command;

#[test]
fn missing_bun_fails_before_installing_either_binary() {
    for task in ["install", "install-tui"] {
        let destination =
            std::env::temp_dir().join(format!("diffr-no-bun-{}-{task}", std::process::id()));
        let output = Command::new(env!("CARGO_BIN_EXE_xtask"))
            .args([task, "--root"])
            .arg(&destination)
            .env("PATH", "")
            .env_remove("DIFFR_BUN")
            .output()
            .unwrap();
        assert!(!output.status.success());
        let error = String::from_utf8_lossy(&output.stderr);
        assert!(error.contains("Bun was not found"), "{error}");
        assert!(error.contains("PATH"), "{error}");
        assert!(!destination.exists());
    }
}
