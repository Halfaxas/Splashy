#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

mod api;
mod fs;
mod getter;
mod scheduler;
mod settings;
mod unsplash;
mod wallpaper;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("debug")).init();
    log::info!("Starting wallpaper app");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .setup(|app| {
            // On Windows, disable decorations (custom TitleBar component handles it)
            #[cfg(target_os = "windows")]
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_decorations(false);
            }

            // Show window on normal launch; skip if auto-started with --hidden
            let is_autostart = std::env::args().any(|a| a == "--hidden");
            if !is_autostart {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                }
            }

            scheduler::run_startup_sync();
            scheduler::start_wallpaper_scheduler(app.handle().clone());

            // System tray
            let refresh_item = MenuItem::with_id(app, "refresh", "Refresh Wallpaper", true, None::<&str>)?;
            let open_item = MenuItem::with_id(app, "open", "Open App", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &refresh_item, &sep, &quit_item])?;

            TrayIconBuilder::new()
                .icon({
                    #[cfg(target_os = "macos")]
                    {
                        static TRAY_ICON: &[u8] = include_bytes!("../icons/tray-icon.png");
                        tauri::image::Image::from_bytes(TRAY_ICON)
                            .unwrap_or_else(|_| app.default_window_icon().unwrap().clone())
                    }
                    #[cfg(not(target_os = "macos"))]
                    app.default_window_icon().unwrap().clone()
                })
                .icon_as_template(true)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "refresh" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            match crate::wallpaper::change_wallpaper().await {
                                Ok(_) => { let _ = handle.emit("wallpaper-changed", ()); }
                                Err(e) => log::error!("[tray] Refresh failed: {}", e),
                            }
                        });
                    }
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Hide to tray instead of quitting when the window is closed
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            api::wallpaper::refresh_wallpaper,
            api::wallpaper::get_current_wallpaper,
            api::wallpaper::get_adjacent_wallpapers,
            api::wallpaper::save_wallpaper_to_folder,
            api::collections::list_collections,
            api::collections::import_collection,
            api::collections::delete_collection,
            api::collections::toggle_collection,
            api::users::list_users,
            api::users::follow_user,
            api::users::delete_user,
            api::users::toggle_user,
            api::topics::list_topics,
            api::topics::toggle_topic,
            api::colors::list_colors,
            api::colors::toggle_color,
            api::queries::list_queries,
            api::queries::add_query,
            api::queries::delete_query,
            api::queries::toggle_query,
            api::related::import_related_source,
            api::related::list_related_sources,
            api::related::delete_related_source,
            api::related::toggle_related_source,
            api::settings::get_settings,
            api::settings::update_settings,
            api::settings::get_api_key,
            api::settings::verify_and_save_api_key,
            api::time_groups::get_time_groups,
            api::time_groups::set_target_groups,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
