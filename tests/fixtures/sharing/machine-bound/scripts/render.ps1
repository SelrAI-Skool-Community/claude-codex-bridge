# Render the weekly report. Written on one machine; the paths are not yet portable.
$template = "C:\Users\marlo\Documents\report-tools\templates\report.html"
$ffmpeg = "D:\tools\ffmpeg\bin\ffmpeg.exe"
Copy-Item "\\OFFICE-NAS\shared\templates\logo.png" -Destination .
bash /Users/jesie/projects/tools/helper.sh
& /opt/homebrew/bin/pngquant logo.png
