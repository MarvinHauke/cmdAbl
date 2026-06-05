#Requires AutoHotkey v2.0
#HotIf WinActive("ahk_exe Ableton Live.exe")
+.:: {
    try {
        whr := ComObject("WinHttp.WinHttpRequest.5.1")
        whr.Open("GET", "http://127.0.0.1:27184/state", false)
        whr.Send()
        if (whr.ResponseText = "open") {
            Send("+.")
            return
        }
    }
    Run('curl -s http://127.0.0.1:27184/open',, 'Hide')
}
#HotIf
