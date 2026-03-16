import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as TerminalIcon, Trash2, Copy, ArrowDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { tauriInvoke } from '../utils/tauri';
import { useStore } from '../stores/useStore';
import { Button } from '../components/ui/button';
import { useToast } from '../components/ui/toast';

interface TerminalLine {
  type: 'input' | 'output' | 'error' | 'system';
  content: string;
  timestamp: number;
}

const Terminal: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const device = useStore((s) => {
    const serial = s.activeDeviceSerial;
    return serial ? s.connectedDevices.find((d) => d.serial === serial) || null : null;
  });

  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [running, setRunning] = useState(false);
  const [cwd, setCwd] = useState('/sdcard');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Welcome message
  useEffect(() => {
    if (device) {
      setLines([{
        type: 'system',
        content: `${t('terminal.connected', { device: device.displayName || device.model, serial: device.serial })}`,
        timestamp: Date.now(),
      }, {
        type: 'system',
        content: t('terminal.hint'),
        timestamp: Date.now(),
      }]);
    }
  }, [device?.serial]);

  const addLine = useCallback((type: TerminalLine['type'], content: string) => {
    setLines((prev) => [...prev, { type, content, timestamp: Date.now() }]);
  }, []);

  const executeCommand = async (cmd: string) => {
    if (!device || !cmd.trim()) return;

    const trimmed = cmd.trim();
    addLine('input', `${cwd} $ ${trimmed}`);

    // Update history
    setHistory((prev) => {
      const filtered = prev.filter((h) => h !== trimmed);
      return [trimmed, ...filtered].slice(0, 100);
    });
    setHistoryIndex(-1);
    setInput('');

    // Handle local commands
    if (trimmed === 'clear') {
      setLines([]);
      return;
    }

    setRunning(true);
    try {
      // Wrap command with cd to maintain working directory
      const fullCmd = `cd '${cwd.replace(/'/g, "'\\''")}' 2>/dev/null; ${trimmed}; echo "___CWD___$(pwd)"`;
      const output = await tauriInvoke<string>('shell_execute', {
        serial: device.serial,
        command: fullCmd,
      });

      // Extract cwd from output
      const cwdMatch = output.match(/___CWD___(.*?)$/m);
      if (cwdMatch) {
        const newCwd = cwdMatch[1].trim();
        if (newCwd && newCwd.startsWith('/')) {
          setCwd(newCwd);
        }
      }

      // Display output without the cwd marker
      const cleanOutput = output.replace(/___CWD___.*$/m, '').trimEnd();
      if (cleanOutput) {
        addLine('output', cleanOutput);
      }
    } catch (err: any) {
      addLine('error', String(err));
    } finally {
      setRunning(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      executeCommand(input);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      } else {
        setHistoryIndex(-1);
        setInput('');
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      if (!input) {
        addLine('system', '^C');
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      setLines([]);
    }
  };

  const handleCopyAll = () => {
    const text = lines.map((l) => l.content).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      toast.success(t('common.copy'));
    }).catch(() => {});
  };

  if (!device) {
    return (
      <div className="p-[var(--page-padding)]">
        <div className="rounded-[var(--border-radius)] border border-border bg-white p-8 text-center">
          <TerminalIcon className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">{t('common.connectDevice')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-[var(--page-padding)] h-full flex flex-col">
      <div className="rounded-[var(--border-radius)] border border-border bg-gray-900 flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <TerminalIcon className="h-4 w-4 text-green-400" />
            <span className="text-green-400 text-sm font-mono">
              {t('terminal.title')} - {device.displayName || device.model}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-400 hover:text-white hover:bg-gray-700"
              onClick={handleCopyAll}
              title={t('common.copy')}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-400 hover:text-white hover:bg-gray-700"
              onClick={() => setAutoScroll(!autoScroll)}
              title="Auto-scroll"
            >
              <ArrowDown className={`h-3.5 w-3.5 ${autoScroll ? 'text-green-400' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-gray-400 hover:text-white hover:bg-gray-700"
              onClick={() => setLines([])}
              title={t('common.clear')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Terminal output */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto p-4 font-mono text-sm leading-relaxed"
          onClick={() => inputRef.current?.focus()}
        >
          {lines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">
              {line.type === 'input' && (
                <span className="text-green-400">{line.content}</span>
              )}
              {line.type === 'output' && (
                <span className="text-gray-200">{line.content}</span>
              )}
              {line.type === 'error' && (
                <span className="text-red-400">{line.content}</span>
              )}
              {line.type === 'system' && (
                <span className="text-yellow-400 italic">{line.content}</span>
              )}
            </div>
          ))}

          {/* Input line */}
          <div className="flex items-center mt-1">
            <span className="text-blue-400 mr-2 flex-shrink-0 font-mono">{cwd} $</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent text-gray-200 outline-none font-mono caret-green-400"
              disabled={running}
              autoComplete="off"
              spellCheck={false}
            />
            {running && (
              <span className="text-yellow-400 ml-2 animate-pulse">...</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Terminal;
