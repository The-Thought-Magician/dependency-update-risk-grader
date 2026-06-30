import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
}

export function Button({ variant = 'primary', className = '', children, ...props }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-lime-500/60 disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-lime-400 text-neutral-950 hover:bg-lime-300',
    secondary: 'bg-neutral-800 text-neutral-100 hover:bg-neutral-700 border border-neutral-700',
    ghost: 'text-neutral-400 hover:text-neutral-100 hover:bg-neutral-800',
    danger: 'bg-red-600 text-white hover:bg-red-500',
  }
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  )
}

export default Button
