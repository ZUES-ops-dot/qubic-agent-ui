import type { Metadata } from 'next'
import { ToastContainer } from '@/components/ui/toast'
import './globals.css'

export const metadata: Metadata = {
  title: 'Qubic Agent',
  description: 'AI-powered smart contract agent',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: `(function(){try{
          var t=localStorage.getItem('qubic-theme-mode');
          if(t&&t!=='dark'){document.documentElement.setAttribute('data-theme',t);}
          if(localStorage.getItem('qubic-compact')==='1')document.documentElement.classList.add('compact');
          if(localStorage.getItem('qubic-animations')==='0')document.documentElement.classList.add('reduce-motion');
        }catch(e){}})()`}} />
      </head>
      <body className="font-sans antialiased">
        {children}
        <ToastContainer />
      </body>
    </html>
  )
}
