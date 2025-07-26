#!/bin/bash

# Change to the script's directory
cd "$(dirname "$0")"

# PM2 App Name
PM2_APP_NAME="ai-editor-backend"

# Check for root/sudo privileges
IS_ADMIN=false
if [ "$(id -u)" -eq 0 ]; then
    IS_ADMIN=true
fi

# --- Functions ---

check_admin() {
    if [ "$IS_ADMIN" = false ]; then
        echo "=================================== WARNING ==================================="
        echo
        echo " This option requires root privileges (sudo)."
        echo " Please run this script with 'sudo ./app.sh'."
        echo
        echo "==============================================================================="
        echo
        read -p "Press Enter to continue..."
        return 1
    fi
    return 0
}

install_deps() {
    echo "--- 1. Installing backend Node.js dependencies..."
    (cd backend && npm install)
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install backend Node.js dependencies."
        read -p "Press Enter to continue..."
        return
    fi
    echo
    echo "--- 2. Installing PM2 globally..."
    npm install pm2 -g
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install PM2 globally."
        read -p "Press Enter to continue..."
        return
    fi
    echo
    echo "Installation complete."
    read -p "Press Enter to continue..."
}

start_server() {
    echo "Starting the backend server with PM2..."
    pm2 start backend/index.js --name "$PM2_APP_NAME"
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to start the backend server."
        read -p "Press Enter to continue..."
    fi
    read -p "Press Enter to continue..."
}

stop_server() {
    echo "Stopping the server..."
    pm2 stop "$PM2_APP_NAME"
}

restart_server() {
    echo "Restarting the server..."
    pm2 restart "$PM2_APP_NAME"
}

show_status() {
    pm2 list
    read -p "Press Enter to continue..."
}

startup_on() {
    check_admin || return
    echo "--- Enabling auto-startup on system reboot ---"
    pm2 startup
    pm2 save
    echo "--- Auto-startup has been configured ---"
    read -p "Press Enter to continue..."
}

startup_off() {
    check_admin || return
    echo "--- Disabling auto-startup ---"
    pm2 unstartup
    echo "--- Auto-startup has been disabled ---"
    read -p "Press Enter to continue..."
}

eradicate_pm2() {
    check_admin || return
    echo
    echo "======================================================================="
    echo "           !!! DANGER: COMPLETE PM2 ERADICATION !!!"
    echo "======================================================================="
    echo
    echo " This will uninstall PM2, delete all its configurations, and kill"
    echo " any related processes. This is for a complete fresh start."
    echo
    read -p "Are you sure? This cannot be undone. (y/n): " confirm
    if [ "$confirm" != "y" ]; then
        return
    fi

    echo
    echo "--- Step 1: Terminating all Node.js and PM2 processes..."
    pkill -f node
    pkill -f PM2
    echo

    echo "--- Step 2: Uninstalling PM2 globally..."
    npm uninstall pm2 -g
    echo

    echo "--- Step 3: Deleting the PM2 configuration directory..."
    rm -rf ~/.pm2
    echo

    echo "PM2 has been completely removed. Please run option [1] to reinstall."
    read -p "Press Enter to continue..."
}

# --- Main Menu ---

while true; do
    clear
    echo "================================================================="
    echo "  AI Code Editor - Server Management (macOS/Linux)"
    echo "================================================================="
    echo
    echo "  -- Standard Operations --"
    echo "  [1] Install Dependencies (Run this first)"
    echo "  [2] Start Server"
    echo "  [3] Stop Server"
    echo "  [4] Restart Server"
    echo "  [5] View Server Status"
    echo
    echo "  -- Administrative Tasks (Requires sudo) --"
    echo "  [6] Enable Auto-Startup on Reboot"
    echo "  [7] Disable Auto-Startup on Reboot"
    echo "  [X] Nuke PM2 (Complete Reset)"
    echo
    echo "  [0] Exit"
    echo
    read -p "Enter your choice: " choice

    case $choice in
        1) install_deps ;;
        2) start_server ;;
        3) stop_server ;;
        4) restart_server ;;
        5) show_status ;;
        6) startup_on ;;
        7) startup_off ;;
        [Xx]) eradicate_pm2 ;;
        0) break ;;
        *) echo "Invalid choice. Please try again."; read -p "Press Enter to continue..." ;;
    esac
done