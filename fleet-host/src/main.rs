use std::env;
use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 8765;

fn fm_home() -> PathBuf {
    env::var("FM_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("/Users/kayisrahman/Documents/workspace/firstmate"))
}

fn state_dir() -> PathBuf {
    env::var("FM_STATE_OVERRIDE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| fm_home().join("state"))
}

fn assets_dir() -> PathBuf {
    let home_assets = fm_home().join("assets").join("fleet-ui");
    if home_assets.join("index.html").is_file() {
        home_assets
    } else {
        // Fall back to repo-side assets if present.
        let repo_assets = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap_or(Path::new("."))
            .join("assets")
            .join("fleet-ui");
        if repo_assets.join("index.html").is_file() {
            repo_assets
        } else {
            home_assets
        }
    }
}

fn snapshot_script() -> Option<PathBuf> {
    let home = fm_home().join("bin").join("fm-fleet-snapshot.sh");
    if home.is_file() {
        return Some(home);
    }
    let sibling = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap_or(Path::new("."))
        .join("bin")
        .join("fm-fleet-snapshot.sh");
    if sibling.is_file() {
        return Some(sibling);
    }
    None
}

fn mime_for(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "json" => "application/json",
        "js" => "application/javascript",
        "css" => "text/css",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

fn is_loopback(host: &str) -> bool {
    matches!(host, "127.0.0.1" | "localhost" | "::1" | "0:0:0:0:0:0:0:1")
        || host.starts_with("127.")
}

fn build(out: &Path) {
    fs::create_dir_all(out).expect("create out dir");
    fs::create_dir_all(out.join("data")).expect("create data dir");
    // Copy dashboard assets (read-only source).
    let idx = assets_dir().join("index.html");
    if idx.is_file() {
        let _ = fs::copy(&idx, out.join("index.html"));
    }
    // Run the read-only snapshot helper if available; its output is observational.
    if let Some(script) = snapshot_script() {
        let result = Command::new("bash").arg(&script).arg("--json").output();
        if let Ok(o) = result {
            if o.status.success() {
                let _ = fs::write(out.join("data").join("snapshot.json"), o.stdout);
            } else {
                let _ = fs::write(out.join("data").join("snapshot.json"), b"{}");
            }
        } else {
            let _ = fs::write(out.join("data").join("snapshot.json"), b"{}");
        }
    } else {
        let _ = fs::write(out.join("data").join("snapshot.json"), b"{}");
    }
}

fn serve_file(out: &Path, stream: &mut TcpStream, path: &str) {
    let rel = path.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    // Prevent traversal.
    if rel.contains("..") {
        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n");
        return;
    }
    let full = out.join(rel);
    if full.is_dir() {
        let idx = full.join("index.html");
        if idx.is_file() {
            serve_file(
                out,
                stream,
                &format!("{}/index.html", rel.trim_end_matches('/')),
            );
            return;
        }
    }
    match fs::read(&full) {
        Ok(bytes) => {
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                mime_for(&full),
                bytes.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&bytes);
        }
        Err(_) => {
            let _ = stream.write_all(
                b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            );
        }
    }
}

fn serve(host: &str, port: u16, out: &Path) {
    let addr = format!("{}:{}", host, port);
    let listener = TcpListener::bind(&addr).expect("bind failed");
    println!("fm-fleet-ui: serving {} on {}", out.display(), addr);
    for mut stream in listener.incoming().flatten() {
        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let req = String::from_utf8_lossy(&buf[..n]);
        let first = req.lines().next().unwrap_or("");
        let mut parts = first.split_whitespace();
        let method = parts.next().unwrap_or("");
        let target = parts.next().unwrap_or("/");
        if method != "GET" && method != "HEAD" {
            let _ = stream.write_all(b"HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        }
        let path = target.split('?').next().unwrap_or("/").to_string();
        let out_clone = out.to_path_buf();
        thread::spawn(move || {
            let mut s = stream;
            serve_file(&out_clone, &mut s, &path);
        });
    }
}

fn print_usage() {
    println!("usage: fm-fleet-ui <build|refresh|serve|path> [options]");
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let mut mode = String::from("serve");
    let mut out: Option<PathBuf> = None;
    let mut host = String::from(DEFAULT_HOST);
    let mut host_explicit = false;
    let mut port = DEFAULT_PORT;
    let mut no_build = false;

    let mut i = 0;
    if !args.is_empty() {
        match args[0].as_str() {
            "build" | "refresh" | "serve" | "path" => {
                mode = args[0].clone();
                i = 1;
            }
            "-h" | "--help" => {
                print_usage();
                return;
            }
            _ => {}
        }
    }
    while i < args.len() {
        match args[i].as_str() {
            "--out" => {
                out = Some(PathBuf::from(&args[i + 1]));
                i += 2;
            }
            "--host" => {
                host = args[i + 1].clone();
                host_explicit = true;
                i += 2;
            }
            "--port" => {
                port = args[i + 1].parse().unwrap_or(DEFAULT_PORT);
                i += 2;
            }
            "--no-build" => {
                no_build = true;
                i += 1;
            }
            _ => {
                i += 1;
            }
        }
    }
    if mode == "refresh" {
        mode = "build".to_string();
    }
    let out = out.unwrap_or_else(|| state_dir().join("fleet-ui"));

    if mode == "path" {
        println!("{}", out.display());
        return;
    }
    if mode == "build" {
        build(&out);
        println!("{}", out.display());
        return;
    }
    // serve
    if !host_explicit {
        host = DEFAULT_HOST.to_string();
    }
    if !host_explicit && !is_loopback(&host) {
        eprintln!("fm-fleet-ui: refusing non-loopback bind without explicit --host");
        return;
    }
    if !no_build {
        build(&out);
    }
    // Background refresh on configurable cadence (live status).
    let out_refresh = out.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        build(&out_refresh);
    });
    serve(&host, port, &out);
}
