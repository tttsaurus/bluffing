import { useEffect, useRef, type ReactNode } from 'react'

/** Native dialogs provide focus containment, Escape handling and focus restoration. */
export function Modal({ children, label, onClose, className = "" }: { children: ReactNode; label: string; onClose: () => void; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current
    const previousFocus = document.activeElement
    element?.showModal()
    return () => {
      element?.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])
  return <dialog ref={dialog} className={`dialog-surface ${className}`} aria-label={label}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { if (event.target === event.currentTarget) onClose() }}>
    {children}
  </dialog>
}
