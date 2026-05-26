pub mod client;
pub mod models;

pub use client::UnsplashClient;
pub use models::*;

/// Build a client using the API key stored in settings.
/// Returns an error if no key has been configured yet.
pub fn get_client() -> Result<UnsplashClient, String> {
    let settings = crate::settings::load_settings()?;
    let key = settings.api_key.ok_or_else(|| {
        "ERR_NO_API_KEY: No Unsplash API key configured. Please add your key in Settings.".to_string()
    })?;
    Ok(UnsplashClient::new(key))
}
