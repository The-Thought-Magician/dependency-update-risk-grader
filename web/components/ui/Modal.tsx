'use client'
import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  className?: string
}

export function Modal({ open, onClose, title, children, footer, className = '' }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className={`relative z-10 w-full max-w-lg rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl ${className}`}
      >
        {title != null && (
          <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
            <h2 className="text-base font-semibold text-neutral-100">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer != null && <div className="flex justify-end gap-2 border-t border-neutral-800 px-5 py-4">{footer}</div>}
      </div>
    </div>
  )
}

export default Modal
