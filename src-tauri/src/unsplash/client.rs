use super::models::{
    ApiCollection, ApiPhoto, ApiPhotoStatistics, ApiRelatedPhotosResult, ApiSearchPhotosResult,
    ApiTopic, ApiUserProfile,
};

pub struct UnsplashClient {
    pub(crate) inner: reqwest::Client,
    access_key: String,
}

impl UnsplashClient {
    pub fn new(access_key: impl Into<String>) -> Self {
        let inner = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("Failed to build HTTP client");
        Self {
            inner,
            access_key: access_key.into(),
        }
    }

    fn auth(&self) -> String {
        format!("Client-ID {}", self.access_key)
    }

    fn check_status(status: reqwest::StatusCode, body: &str) -> Result<(), String> {
        if status.as_u16() == 429 {
            return Err("ERR_RATE_LIMITED: 429 Too Many Requests".to_string());
        }
        if status.as_u16() == 403 {
            return Err("ERR_RATE_LIMITED: 403 Forbidden".to_string());
        }
        if !status.is_success() {
            return Err(format!("Unsplash API error {}: {}", status, body));
        }
        Ok(())
    }

    /// GET /photos/random with arbitrary query params.
    pub async fn get_random_photo(&self, params: &[(&str, &str)]) -> Result<ApiPhoto, String> {
        let query_str = params
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&");
        log::debug!(
            "[unsplash] GET https://api.unsplash.com/photos/random?{}",
            query_str
        );

        let resp = self
            .inner
            .get("https://api.unsplash.com/photos/random")
            .query(params)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        log::debug!("[unsplash] /photos/random -> {}", status);

        if status.as_u16() == 429 {
            return Err("ERR_RATE_LIMITED: 429 Too Many Requests".to_string());
        }
        if status.as_u16() == 403 {
            return Err("ERR_RATE_LIMITED: 403 Forbidden".to_string());
        }
        if !status.is_success() {
            let txt = resp.text().await.unwrap_or_default();
            log::warn!("[unsplash] /photos/random error body: {}", txt);
            return Err(format!("Unsplash API error {}: {}", status, txt));
        }

        resp.json::<ApiPhoto>()
            .await
            .map_err(|e| format!("Failed to parse photo JSON: {}", e))
    }

    /// Fire-and-forget download registration per Unsplash guidelines.
    pub async fn register_download(&self, url: &str) {
        log::debug!("[unsplash] register_download: GET {}", url);
        let _ = self
            .inner
            .get(url)
            .header("Authorization", self.auth())
            .send()
            .await;
    }

    /// GET /collections/:id with optional ETag for conditional fetch.
    /// Returns `None` on 304 Not Modified, `Some((collection, new_etag))` on 200.
    pub async fn poll_collection(
        &self,
        id: &str,
        etag: Option<&str>,
    ) -> Result<Option<(ApiCollection, Option<String>)>, String> {
        let url = format!("https://api.unsplash.com/collections/{}", id);
        log::debug!("[unsplash] GET {} (etag={:?})", url, etag);

        let mut req = self.inner.get(&url).header("Authorization", self.auth());
        if let Some(tag) = etag {
            req = req.header("If-None-Match", tag);
        }
        let resp = req.send().await.map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        if status.as_u16() == 304 {
            log::debug!("[unsplash] GET {} -> 304 Not Modified", url);
            return Ok(None);
        }
        if status.as_u16() == 404 {
            return Err(format!("ERR_COLLECTION_NOT_FOUND: {}", id));
        }

        let new_etag = resp
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        let collection = serde_json::from_str::<ApiCollection>(&body)
            .map_err(|e| format!("Failed to parse collection JSON: {}", e))?;

        Ok(Some((collection, new_etag)))
    }

    /// GET /collections/:id
    pub async fn get_collection(&self, id: &str) -> Result<ApiCollection, String> {
        let url = format!("https://api.unsplash.com/collections/{}", id);
        log::debug!("[unsplash] GET {}", url);
        let resp = self
            .inner
            .get(&url)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        log::debug!("[unsplash] GET {} -> {}", url, status);
        if status.as_u16() == 404 {
            return Err(format!("ERR_COLLECTION_NOT_FOUND: {}", id));
        }
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<ApiCollection>(&body)
            .map_err(|e| format!("Failed to parse collection JSON: {}", e))
    }

    /// GET /users/:username
    pub async fn get_user_profile(&self, username: &str) -> Result<ApiUserProfile, String> {
        let url = format!("https://api.unsplash.com/users/{}", username);
        log::debug!("[unsplash] GET {}", url);
        let resp = self
            .inner
            .get(&url)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        log::debug!("[unsplash] GET {} -> {}", url, status);
        if status.as_u16() == 404 {
            return Err(format!("ERR_USER_NOT_FOUND: {}", username));
        }
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<ApiUserProfile>(&body)
            .map_err(|e| format!("Failed to parse user profile JSON: {}", e))
    }

    /// GET /topics — returns up to 30 topics.
    pub async fn get_topics(&self) -> Result<Vec<ApiTopic>, String> {
        log::debug!("[unsplash] GET https://api.unsplash.com/topics?per_page=30");
        let resp = self
            .inner
            .get("https://api.unsplash.com/topics")
            .query(&[("per_page", "30")])
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<Vec<ApiTopic>>(&body)
            .map_err(|e| format!("Failed to parse topics JSON: {}", e))
    }

    /// GET /photos — list a page of photos.
    pub async fn list_photos(
        &self,
        page: u32,
        per_page: u32,
        order_by: &str,
    ) -> Result<Vec<ApiPhoto>, String> {
        log::debug!("[unsplash] GET /photos?page={}&per_page={}&order_by={}", page, per_page, order_by);
        let resp = self
            .inner
            .get("https://api.unsplash.com/photos")
            .query(&[
                ("page", page.to_string()),
                ("per_page", per_page.to_string()),
                ("order_by", order_by.to_string()),
            ])
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<Vec<ApiPhoto>>(&body)
            .map_err(|e| format!("Failed to parse photos JSON: {}", e))
    }

    /// GET /photos/:photo_id — retrieve a single photo by ID.
    pub async fn get_photo(&self, photo_id: &str) -> Result<ApiPhoto, String> {
        let url = format!("https://api.unsplash.com/photos/{}", photo_id);
        log::debug!("[unsplash] GET {}", url);
        let resp = self
            .inner
            .get(&url)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        if status.as_u16() == 404 {
            return Err(format!("Photo not found: {}", photo_id));
        }
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<ApiPhoto>(&body)
            .map_err(|e| format!("Failed to parse photo JSON: {}", e))
    }

    /// GET /photos/:photo_id/statistics
    pub async fn get_photo_statistics(
        &self,
        photo_id: &str,
        resolution: &str,
        quantity: u32,
    ) -> Result<ApiPhotoStatistics, String> {
        let url = format!("https://api.unsplash.com/photos/{}/statistics", photo_id);
        log::debug!("[unsplash] GET {}?resolution={}&quantity={}", url, resolution, quantity);
        let resp = self
            .inner
            .get(&url)
            .query(&[
                ("resolution", resolution.to_string()),
                ("quantity", quantity.to_string()),
            ])
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<ApiPhotoStatistics>(&body)
            .map_err(|e| format!("Failed to parse photo statistics JSON: {}", e))
    }

    /// GET /photos/:photo_id/download — track a download per Unsplash guidelines.
    pub async fn track_photo_download(&self, photo_id: &str) -> Result<(), String> {
        let url = format!("https://api.unsplash.com/photos/{}/download", photo_id);
        log::debug!("[unsplash] GET {} (track download)", url);
        let resp = self
            .inner
            .get(&url)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Track download failed {}: {}", status, body));
        }
        Ok(())
    }

    /// GET /search/photos
    pub async fn search_photos(
        &self,
        query: &str,
        page: u32,
        per_page: u32,
        orientation: Option<&str>,
        collections: Option<&str>,
        color: Option<&str>,
        content_filter: &str,
    ) -> Result<ApiSearchPhotosResult, String> {
        log::debug!("[unsplash] GET /search/photos?query={}&page={}&per_page={}", query, page, per_page);
        let mut params: Vec<(&str, String)> = vec![
            ("query", query.to_string()),
            ("page", page.to_string()),
            ("per_page", per_page.to_string()),
            ("content_filter", content_filter.to_string()),
        ];
        if let Some(o) = orientation {
            params.push(("orientation", o.to_string()));
        }
        if let Some(c) = collections {
            params.push(("collections", c.to_string()));
        }
        if let Some(c) = color {
            params.push(("color", c.to_string()));
        }

        let resp = self
            .inner
            .get("https://api.unsplash.com/search/photos")
            .query(&params)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<ApiSearchPhotosResult>(&body)
            .map_err(|e| format!("Failed to parse search result JSON: {}", e))
    }

    /// GET /collections — list public collections (paginated).
    pub async fn list_collections_api(
        &self,
        page: u32,
        per_page: u32,
    ) -> Result<Vec<ApiCollection>, String> {
        log::debug!("[unsplash] GET /collections?page={}&per_page={}", page, per_page);
        let resp = self
            .inner
            .get("https://api.unsplash.com/collections")
            .query(&[("page", page.to_string()), ("per_page", per_page.to_string())])
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<Vec<ApiCollection>>(&body)
            .map_err(|e| format!("Failed to parse collections JSON: {}", e))
    }

    /// GET /collections/:id/photos
    pub async fn get_collection_photos(
        &self,
        collection_id: &str,
        page: u32,
        per_page: u32,
        orientation: Option<&str>,
    ) -> Result<Vec<ApiPhoto>, String> {
        let url = format!(
            "https://api.unsplash.com/collections/{}/photos",
            collection_id
        );
        log::debug!("[unsplash] GET {}?page={}&per_page={}", url, page, per_page);
        let mut params = vec![
            ("page", page.to_string()),
            ("per_page", per_page.to_string()),
        ];
        if let Some(o) = orientation {
            params.push(("orientation", o.to_string()));
        }

        let resp = self
            .inner
            .get(&url)
            .query(&params)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        if status.as_u16() == 404 {
            return Err(format!("ERR_COLLECTION_NOT_FOUND: {}", collection_id));
        }
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<Vec<ApiPhoto>>(&body)
            .map_err(|e| format!("Failed to parse collection photos JSON: {}", e))
    }

    /// GET /users/:username/photos
    pub async fn get_user_photos(
        &self,
        username: &str,
        page: u32,
        per_page: u32,
        order_by: &str,
        orientation: Option<&str>,
    ) -> Result<Vec<ApiPhoto>, String> {
        let url = format!("https://api.unsplash.com/users/{}/photos", username);
        log::debug!("[unsplash] GET {}?page={}&per_page={}&order_by={}", url, page, per_page, order_by);
        let mut params = vec![
            ("page", page.to_string()),
            ("per_page", per_page.to_string()),
            ("order_by", order_by.to_string()),
        ];
        if let Some(o) = orientation {
            params.push(("orientation", o.to_string()));
        }

        let resp = self
            .inner
            .get(&url)
            .query(&params)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        if status.as_u16() == 404 {
            return Err(format!("ERR_USER_NOT_FOUND: {}", username));
        }
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<Vec<ApiPhoto>>(&body)
            .map_err(|e| format!("Failed to parse user photos JSON: {}", e))
    }

    /// GET /users/:username/collections
    pub async fn get_user_collections(
        &self,
        username: &str,
        page: u32,
        per_page: u32,
    ) -> Result<Vec<ApiCollection>, String> {
        let url = format!("https://api.unsplash.com/users/{}/collections", username);
        log::debug!("[unsplash] GET {}?page={}&per_page={}", url, page, per_page);
        let resp = self
            .inner
            .get(&url)
            .query(&[("page", page.to_string()), ("per_page", per_page.to_string())])
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        if status.as_u16() == 404 {
            return Err(format!("ERR_USER_NOT_FOUND: {}", username));
        }
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<Vec<ApiCollection>>(&body)
            .map_err(|e| format!("Failed to parse user collections JSON: {}", e))
    }

    /// GET /users/:username/likes
    pub async fn get_user_liked_photos(
        &self,
        username: &str,
        page: u32,
        per_page: u32,
        order_by: &str,
        orientation: Option<&str>,
    ) -> Result<Vec<ApiPhoto>, String> {
        let url = format!("https://api.unsplash.com/users/{}/likes", username);
        log::debug!("[unsplash] GET {}?page={}&per_page={}&order_by={}", url, page, per_page, order_by);
        let mut params = vec![
            ("page", page.to_string()),
            ("per_page", per_page.to_string()),
            ("order_by", order_by.to_string()),
        ];
        if let Some(o) = orientation {
            params.push(("orientation", o.to_string()));
        }

        let resp = self
            .inner
            .get(&url)
            .query(&params)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        if status.as_u16() == 404 {
            return Err(format!("ERR_USER_NOT_FOUND: {}", username));
        }
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<Vec<ApiPhoto>>(&body)
            .map_err(|e| format!("Failed to parse user liked photos JSON: {}", e))
    }

    /// GET /topics — paginated with ordering.
    pub async fn list_topics_paged(
        &self,
        page: u32,
        per_page: u32,
        order_by: &str,
    ) -> Result<Vec<ApiTopic>, String> {
        log::debug!("[unsplash] GET /topics?page={}&per_page={}&order_by={}", page, per_page, order_by);
        let resp = self
            .inner
            .get("https://api.unsplash.com/topics")
            .query(&[
                ("page", page.to_string()),
                ("per_page", per_page.to_string()),
                ("order_by", order_by.to_string()),
            ])
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<Vec<ApiTopic>>(&body)
            .map_err(|e| format!("Failed to parse topics JSON: {}", e))
    }

    /// GET /topics/:id_or_slug/photos
    pub async fn get_topic_photos(
        &self,
        id_or_slug: &str,
        page: u32,
        per_page: u32,
        order_by: &str,
        orientation: Option<&str>,
    ) -> Result<Vec<ApiPhoto>, String> {
        let url = format!("https://api.unsplash.com/topics/{}/photos", id_or_slug);
        log::debug!("[unsplash] GET {}?page={}&per_page={}&order_by={}", url, page, per_page, order_by);
        let mut params = vec![
            ("page", page.to_string()),
            ("per_page", per_page.to_string()),
            ("order_by", order_by.to_string()),
        ];
        if let Some(o) = orientation {
            params.push(("orientation", o.to_string()));
        }

        let resp = self
            .inner
            .get(&url)
            .query(&params)
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        if status.as_u16() == 404 {
            return Err(format!("Topic not found: {}", id_or_slug));
        }
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<Vec<ApiPhoto>>(&body)
            .map_err(|e| format!("Failed to parse topic photos JSON: {}", e))
    }

    /// GET /photos/:photo_id/related?page=<N> — returns related photos.
    /// Returns Err containing "ERR_BAD_PAGE" on 400 (page out of range).
    pub async fn get_related_photos(
        &self,
        photo_id: &str,
        page: u32,
    ) -> Result<ApiRelatedPhotosResult, String> {
        let url = format!("https://api.unsplash.com/photos/{}/related", photo_id);
        log::debug!("[unsplash] GET {}?page={}", url, page);
        let resp = self
            .inner
            .get(&url)
            .query(&[("page", page.to_string())])
            .header("Authorization", self.auth())
            .send()
            .await
            .map_err(|e| format!("ERR_NETWORK: {}", e))?;

        let status = resp.status();
        if status.as_u16() == 400 {
            return Err(format!("ERR_BAD_PAGE: 400 for page {}", page));
        }
        let body = resp.text().await.unwrap_or_default();
        Self::check_status(status, &body)?;

        serde_json::from_str::<ApiRelatedPhotosResult>(&body)
            .map_err(|e| format!("Failed to parse related photos JSON: {}", e))
    }

    /// Download raw image bytes from any URL (no auth header needed).
    /// Returns (bytes, content_type).
    pub async fn download_image(&self, url: &str) -> Result<(Vec<u8>, String), String> {
        let resp = self
            .inner
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Failed to download image: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("Image download failed: status {}", resp.status()));
        }

        let content_type = resp
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string();

        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("Failed to read image bytes: {}", e))?
            .to_vec();

        Ok((bytes, content_type))
    }
}
