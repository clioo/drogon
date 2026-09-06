fn main() {
    let path = std::env::var_os("PATH");
    for harness in drogon_harness::discover(path.as_deref()) {
        println!("{}: {:?}", harness.display_name, harness.availability);
    }
}
