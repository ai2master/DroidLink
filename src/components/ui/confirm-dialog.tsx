import React, { createContext, useContext, useState, useCallback } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogDescription, DialogFooter, DialogBody,
} from './dialog';
import { Button } from './button';

interface ConfirmOptions {
  title: string;
  content?: React.ReactNode;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  onOk?: () => Promise<void> | void;
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => void;
}

const ConfirmContext = createContext<ConfirmContextType | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [loading, setLoading] = useState(false);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    setOpen(true);
  }, []);

  const handleOk = async () => {
    if (options?.onOk) {
      setLoading(true);
      try {
        await options.onOk();
      } finally {
        setLoading(false);
      }
    }
    setOpen(false);
    setOptions(null);
  };

  const handleCancel = () => {
    setOpen(false);
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); }}>
        <DialogContent width={480}>
          <DialogHeader>
            <DialogTitle>{options?.title}</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {typeof options?.content === 'string' ? (
              <p className="text-[var(--font-size-base)] text-gray-600">{options.content}</p>
            ) : options?.content}
          </DialogBody>
          <DialogFooter>
            <Button variant="default" onClick={handleCancel} disabled={loading}>
              {options?.cancelText || 'Cancel'}
            </Button>
            <Button
              variant={options?.danger ? 'destructive' : 'primary'}
              onClick={handleOk}
              loading={loading}
            >
              {options?.okText || 'OK'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
