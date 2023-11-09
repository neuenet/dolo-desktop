// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(
    not(debug_assertions),
    windows_subsystem = "windows"
)]

use tauri::{
    CustomMenuItem, Manager, Menu, MenuEntry, MenuItem, WindowBuilder, WindowMenuEvent, generate_context
};

#[tauri::command]
fn show_settings_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_window("settings") {
        if let Err(e) = window.show() {
            eprintln!("[e] Error showing settings window: {:?}", e);
        }
    } else {
        // The settings window does not exist, so create it
        eprintln!("[i] Settings window not found, creating a new one");

        let new_window = WindowBuilder::new(&app, "settings", tauri::WindowUrl::App("index.html".into()))
            .inner_size(800.0, 350.0)
            .minimizable(false)
            .resizable(false)
            .title("Settings")
            .visible(false) // Set the window to be initially hidden
            .build();

        match new_window {
            Ok(window) => {
                if let Err(e) = window.show() {
                    eprintln!("[e] Error showing new settings window: {:?}", e);
                }
            }
            Err(e) => eprintln!("[e] Failed to create settings window: {:?}", e),
        }

        /*
        // fancy window functionality that'll only show when the content's been loading
        // ChatGPT 4 hasn't figured out how to cleanly do this though...

        match new_window {
            Ok(window) => {
                let window_ = window.clone();
                // Listen for the DOM content loaded event
                app.listen_global("tauri://created", move |_| {
                    // Once the DOM content is loaded, show the window
                    if let Err(e) = window_.show() {
                        eprintln!("Error showing settings window after DOM content loaded: {:?}", e);
                    }
                    // You may want to unlisten to the event after it's shown.
                });
            }
            Err(e) => eprintln!("Failed to create settings window: {:?}", e),
        }
        */
    }
}

fn main() {
    let context = generate_context!();

    // Create the OS's default menu
    let mut menu = Menu::os_default(&context.package_info().name);

    // Create a custom "Settings" menu item with a keyboard shortcut
    let settings_menu_item = CustomMenuItem::new("show_settings", "Settings")
        .accelerator("CmdOrCtrl+,");

    // Find the application submenu, which is typically named after the app and contains the "About" item
    if let Some(app_submenu) = menu.items.iter_mut().find(|item| {
        matches!(item, MenuEntry::Submenu(submenu) if submenu.title == context.package_info().name)
    }) {
        // Cast the menu entry as a submenu (this should always succeed because of the `matches!` check above)
        if let MenuEntry::Submenu(submenu) = app_submenu {
            // MacOS typically has the "About" item as the first item in the app submenu
            // We will insert the "Settings" item directly after the "About" item
            submenu.inner.items.insert(1, settings_menu_item.into()); // Assuming "About" is at index 0
            submenu.inner.items.insert(1, MenuItem::Separator.into()); // Add a separator before the "Settings" item
        }
    }

    tauri::Builder::default()
        .menu(menu)
        .invoke_handler(tauri::generate_handler![show_settings_window])
        // Handle menu item click
        .on_menu_event(|event: WindowMenuEvent| {
            if event.menu_item_id() == "show_settings" {
                show_settings_window(event.window().app_handle());
            }
        })
        // Register other application event handlers and plugins as needed
        .plugin(tauri_plugin_fs_extra::init())
        .run(context)
        .expect("error while running tauri application");
}
