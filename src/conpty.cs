using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

static class RtlfixConpty
{
    const uint ENABLE_WINDOW_INPUT = 0x0008;
    const uint ENABLE_EXTENDED_FLAGS = 0x0080;
    const uint ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const uint CREATE_SUSPENDED = 0x00000004;
    const int STARTF_USESTDHANDLES = 0x00000100;
    const uint PSEUDOCONSOLE_INHERIT_CURSOR = 0x1;
    const ushort KEY_EVENT = 0x0001;
    const ushort VK_MENU = 0x12;
    const ushort WINDOW_BUFFER_SIZE_EVENT = 0x0004;
    const uint INFINITE = 0xFFFFFFFF;
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    static readonly IntPtr PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = (IntPtr)0x00020016;

    [StructLayout(LayoutKind.Sequential)]
    struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential)]
    struct SMALL_RECT { public short Left; public short Top; public short Right; public short Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    struct CONSOLE_SCREEN_BUFFER_INFO
    {
        public COORD dwSize;
        public COORD dwCursorPosition;
        public short wAttributes;
        public SMALL_RECT srWindow;
        public COORD dwMaximumWindowSize;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct INPUT_RECORD
    {
        [FieldOffset(0)] public ushort EventType;
        [FieldOffset(4)] public int bKeyDown;
        [FieldOffset(8)] public ushort wRepeatCount;
        [FieldOffset(10)] public ushort wVirtualKeyCode;
        [FieldOffset(12)] public ushort wVirtualScanCode;
        [FieldOffset(14)] public ushort UnicodeChar;
        [FieldOffset(16)] public uint dwControlKeyState;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS { public ulong A, B, C, D, E, F; }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    delegate bool HandlerRoutine(uint ctrlType);
    delegate int CreateConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr pc);
    delegate int ResizeConsole(IntPtr pc, COORD size);
    delegate void CloseConsole(IntPtr pc);

    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetConsoleMode(IntPtr h, out uint mode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleMode(IntPtr h, uint mode);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetConsoleScreenBufferInfo(IntPtr h, out CONSOLE_SCREEN_BUFFER_INFO info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadConsoleInputW(IntPtr h, [Out] INPUT_RECORD[] buffer, uint length, out uint read);
    [DllImport("kernel32.dll", SetLastError = true)] static extern int CreatePseudoConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr pc);
    [DllImport("kernel32.dll", SetLastError = true)] static extern int ResizePseudoConsole(IntPtr pc, COORD size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern void ClosePseudoConsole(IntPtr pc);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out SafeFileHandle read, out SafeFileHandle write, IntPtr attributes, int size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returnSize);
    [DllImport("kernel32.dll", SetLastError = true)] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleCtrlHandler(HandlerRoutine handler, bool add);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryW(string name);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi)] static extern IntPtr GetProcAddress(IntPtr module, string name);

    static IntPtr console = IntPtr.Zero;
    static IntPtr screen = IntPtr.Zero;
    static IntPtr input = IntPtr.Zero;
    static uint savedMode;
    static bool restoreMode;
    static PROCESS_INFORMATION child;
    static HandlerRoutine handler;
    static COORD size;
    static readonly object sizeLock = new object();
    static readonly object outputLock = new object();
    static Stream output;
    static ResizeConsole resize = ResizePseudoConsole;
    static CloseConsole close = ClosePseudoConsole;

    static int Main(string[] args)
    {
        string commandLine = Environment.GetEnvironmentVariable("RTLFIX_COMMAND");
        string library = Environment.GetEnvironmentVariable("RTLFIX_CONPTY");
        Environment.SetEnvironmentVariable("RTLFIX_COMMAND", null);
        Environment.SetEnvironmentVariable("RTLFIX_CONPTY", null);
        if (string.IsNullOrEmpty(commandLine))
        {
            Console.Error.WriteLine("rtlfix: no program to run");
            return 2;
        }
        input = CreateFileW("CONIN$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
        screen = CreateFileW("CONOUT$", 0xC0000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
        short cols = 80, rows = 24, row = 0, col = 0;
        CONSOLE_SCREEN_BUFFER_INFO info;
        if (GetConsoleScreenBufferInfo(screen, out info))
        {
            cols = (short)(info.srWindow.Right - info.srWindow.Left + 1);
            rows = (short)(info.srWindow.Bottom - info.srWindow.Top + 1);
            row = (short)(info.dwCursorPosition.Y - info.srWindow.Top);
            col = (short)(info.dwCursorPosition.X - info.srWindow.Left);
        }
        output = Console.OpenStandardOutput();
        Send("rtlfix-conpty " + row + " " + col + " " + cols + " " + rows + "\n");

        SafeFileHandle inRead, inWrite, outRead, outWrite;
        if (!CreatePipe(out inRead, out inWrite, IntPtr.Zero, 0) || !CreatePipe(out outRead, out outWrite, IntPtr.Zero, 0))
        {
            Console.Error.WriteLine("rtlfix: cannot create pipes");
            return 3;
        }
        size.X = cols;
        size.Y = rows;
        int result;
        try
        {
            result = Open(library, inRead.DangerousGetHandle(), outWrite.DangerousGetHandle());
        }
        catch (EntryPointNotFoundException)
        {
            Console.Error.WriteLine("rtlfix: this version of Windows has no pseudo console (Windows 10 1809 or newer is needed)");
            return 3;
        }
        if (result != 0)
        {
            Console.Error.WriteLine("rtlfix: cannot create a pseudo console (0x" + result.ToString("x8") + ")");
            return 3;
        }
        inRead.Dispose();
        outWrite.Dispose();

        IntPtr listSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref listSize);
        IntPtr list = Marshal.AllocHGlobal(listSize);
        if (!InitializeProcThreadAttributeList(list, 1, 0, ref listSize) ||
            !UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, console, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
        {
            Console.Error.WriteLine("rtlfix: cannot attach the pseudo console (" + Marshal.GetLastWin32Error() + ")");
            return 3;
        }
        STARTUPINFOEX startup = new STARTUPINFOEX();
        startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.lpAttributeList = list;
        if (!CreateProcessW(null, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, false,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED, IntPtr.Zero, null, ref startup, out child))
        {
            int error = Marshal.GetLastWin32Error();
            close(console);
            Console.Error.WriteLine("rtlfix: cannot start " + commandLine + " (" + new System.ComponentModel.Win32Exception(error).Message + ")");
            return error == 2 || error == 3 ? 127 : 1;
        }
        IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
        if (job != IntPtr.Zero)
        {
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)));
            AssignProcessToJobObject(job, child.hProcess);
        }
        ResumeThread(child.hThread);

        handler = new HandlerRoutine(OnControl);
        SetConsoleCtrlHandler(handler, true);
        if (GetConsoleMode(input, out savedMode))
        {
            restoreMode = true;
            SetConsoleMode(input, ENABLE_VIRTUAL_TERMINAL_INPUT | ENABLE_WINDOW_INPUT | ENABLE_EXTENDED_FLAGS);
        }

        Thread pump = new Thread(delegate () { Pump(outRead); });
        pump.Start();
        FileStream sink = new FileStream(inWrite, FileAccess.Write, 1);
        Thread copier = new Thread(delegate () { Copy(Console.OpenStandardInput(), sink); });
        copier.IsBackground = true;
        copier.Start();
        if (restoreMode)
        {
            Thread reader = new Thread(ReadKeys);
            reader.IsBackground = true;
            reader.Start();
        }
        Thread watcher = new Thread(Watch);
        watcher.IsBackground = true;
        watcher.Start();

        WaitForSingleObject(child.hProcess, INFINITE);
        uint code;
        GetExitCodeProcess(child.hProcess, out code);
        Thread.Sleep(50);
        IntPtr pc = console;
        console = IntPtr.Zero;
        close(pc);
        pump.Join(3000);
        Restore();
        DeleteProcThreadAttributeList(list);
        Marshal.FreeHGlobal(list);
        return (int)code;
    }

    static int Open(string library, IntPtr inRead, IntPtr outWrite)
    {
        IntPtr module = string.IsNullOrEmpty(library) ? IntPtr.Zero : LoadLibraryW(library);
        if (module != IntPtr.Zero)
        {
            IntPtr create = GetProcAddress(module, "ConptyCreatePseudoConsole");
            IntPtr resizer = GetProcAddress(module, "ConptyResizePseudoConsole");
            IntPtr closer = GetProcAddress(module, "ConptyClosePseudoConsole");
            if (create != IntPtr.Zero && resizer != IntPtr.Zero && closer != IntPtr.Zero &&
                ((CreateConsole)Marshal.GetDelegateForFunctionPointer(create, typeof(CreateConsole)))(size, inRead, outWrite, PSEUDOCONSOLE_INHERIT_CURSOR, out console) == 0)
            {
                resize = (ResizeConsole)Marshal.GetDelegateForFunctionPointer(resizer, typeof(ResizeConsole));
                close = (CloseConsole)Marshal.GetDelegateForFunctionPointer(closer, typeof(CloseConsole));
                return 0;
            }
        }
        return CreatePseudoConsole(size, inRead, outWrite, PSEUDOCONSOLE_INHERIT_CURSOR, out console);
    }

    static void Pump(SafeFileHandle source)
    {
        byte[] buffer = new byte[65536];
        using (FileStream stream = new FileStream(source, FileAccess.Read, 1))
        {
            try
            {
                int n;
                while ((n = stream.Read(buffer, 0, buffer.Length)) > 0)
                {
                    lock (outputLock)
                    {
                        output.Write(buffer, 0, n);
                        output.Flush();
                    }
                }
            }
            catch (IOException) { }
        }
    }

    static void Send(string text)
    {
        byte[] bytes = Encoding.ASCII.GetBytes(text);
        try
        {
            lock (outputLock)
            {
                output.Write(bytes, 0, bytes.Length);
                output.Flush();
            }
        }
        catch (IOException) { }
    }

    static void Copy(Stream source, FileStream sink)
    {
        byte[] buffer = new byte[4096];
        try
        {
            int n;
            while ((n = source.Read(buffer, 0, buffer.Length)) > 0)
            {
                sink.Write(buffer, 0, n);
                sink.Flush();
            }
        }
        catch (IOException) { }
    }

    static void ReadKeys()
    {
        INPUT_RECORD[] records = new INPUT_RECORD[256];
        StringBuilder text = new StringBuilder();
        char pending = '\0';
        while (true)
        {
            uint count;
            if (!ReadConsoleInputW(input, records, (uint)records.Length, out count)) return;
            text.Length = 0;
            if (pending != '\0')
            {
                text.Append(pending);
                pending = '\0';
            }
            for (int i = 0; i < count; i++)
            {
                if (records[i].EventType == KEY_EVENT)
                {
                    if (records[i].UnicodeChar == 0 || (records[i].bKeyDown == 0 && records[i].wVirtualKeyCode != VK_MENU)) continue;
                    int repeat = Math.Max(1, (int)records[i].wRepeatCount);
                    for (int r = 0; r < repeat; r++) text.Append((char)records[i].UnicodeChar);
                }
                else if (records[i].EventType == WINDOW_BUFFER_SIZE_EVENT)
                {
                    Resize();
                }
            }
            if (text.Length > 0 && char.IsHighSurrogate(text[text.Length - 1]))
            {
                pending = text[text.Length - 1];
                text.Length -= 1;
            }
            if (text.Length == 0) continue;
            Send("\x1b]rtlfix;in;" + BitConverter.ToString(Encoding.UTF8.GetBytes(text.ToString())).Replace("-", "") + "\x07");
        }
    }

    static void Watch()
    {
        while (true)
        {
            Thread.Sleep(200);
            Resize();
        }
    }

    static void Resize()
    {
        CONSOLE_SCREEN_BUFFER_INFO info;
        if (!GetConsoleScreenBufferInfo(screen, out info)) return;
        lock (sizeLock)
        {
            short cols = (short)(info.srWindow.Right - info.srWindow.Left + 1);
            short rows = (short)(info.srWindow.Bottom - info.srWindow.Top + 1);
            if (console == IntPtr.Zero || (cols == size.X && rows == size.Y) || cols < 1 || rows < 1) return;
            size.X = cols;
            size.Y = rows;
            Send("\x1b]rtlfix;size;" + cols + ";" + rows + "\x07");
            resize(console, size);
        }
    }

    static bool OnControl(uint type)
    {
        if (type == 0 || type == 1) return true;
        TerminateProcess(child.hProcess, 1);
        Restore();
        return false;
    }

    static void Restore()
    {
        if (!restoreMode) return;
        restoreMode = false;
        SetConsoleMode(input, savedMode);
    }
}
