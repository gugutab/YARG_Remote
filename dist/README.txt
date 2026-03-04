YARG Remote Server v1.1.0
---------------------------

INSTALLATION:
1. Extract ALL contents of this ZIP file to the game's root folder (where YARG.exe is located).
   - This will install BepInEx and the Mod automatically.
   - If asked to replace files, click 'Yes'.

HOW TO USE:
1. Start the game.
2. Open the browser on any device on the same Wi-Fi network.
3. Access: http://localhost:8888
   (If on mobile, use your PC's IP, e.g., http://192.168.0.15:8888)

CONFIGURATION:
- If you need to change the port (default 8888), start the game once and then edit the file:
  BepInEx/config/com.gugutab.yarg.remote.cfg

HOW TO DEBUG:
Step 1: Activate the terminal window
  - Navigate to the BepInEx config folder: \BepInEx\config\
  - Open the file BepInEx.cfg in VS Code or Notepad.
  - Press Ctrl + F and search for [Logging.Console].
  - Set Enabled = true

SOURCE CODE:
https://github.com/gugutab/YARG_Remote
