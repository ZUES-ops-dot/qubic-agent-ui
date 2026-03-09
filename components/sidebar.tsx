'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  MessageSquare,
  History,
  Settings,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Plus,
  Shield,
  Play,
  Database,
  Cloud,
  Menu,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'

const navItems = [
  { icon: MessageSquare, label: 'Chat', href: '/' },
  { icon: Shield, label: 'Audit', href: '/audit' },
  { icon: Play, label: 'Simulate', href: '/simulate' },
  { icon: Cloud, label: 'Oracle', href: '/oracle' },
  { icon: Database, label: 'Patterns', href: '/patterns' },
  { icon: History, label: 'History', href: '/history' },
  { icon: Settings, label: 'Settings', href: '/settings' },
]

interface NavContentProps {
  collapsed: boolean
  isOpen: boolean
  pathname: string
  onNewChat: () => void
  onClose: () => void
  onToggleCollapsed: () => void
}

function NavContent({
  collapsed,
  isOpen,
  pathname,
  onNewChat,
  onClose,
  onToggleCollapsed,
}: NavContentProps) {
  return (
    <>
      <div className="p-4 border-b border-[#1A1A1A] flex items-center justify-between h-16">
        {(!collapsed || isOpen) && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#B0FAFF] rounded-md flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-black" />
            </div>
            <span className="text-lg font-bold gradient-text">Qubic Agent</span>
          </div>
        )}
        {collapsed && !isOpen && (
          <div className="w-8 h-8 bg-[#B0FAFF] rounded-md flex items-center justify-center mx-auto">
            <Sparkles className="w-4 h-4 text-black" />
          </div>
        )}
      </div>

      <div className="p-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              onClick={onNewChat}
              className={cn(
                'w-full bg-[#B0FAFF] text-black hover:bg-[#B0FAFF]/90 font-medium glow-primary',
                collapsed && !isOpen ? 'px-0 justify-center' : ''
              )}
            >
              <Plus className="w-4 h-4" />
              {(!collapsed || isOpen) && <span className="ml-2">New Chat</span>}
            </Button>
          </TooltipTrigger>
          {collapsed && !isOpen && <TooltipContent side="right">New Chat</TooltipContent>}
        </Tooltip>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  onClick={onClose}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                    pathname === item.href
                      ? 'text-[#B0FAFF] bg-[#B0FAFF]/10 font-semibold'
                      : 'text-[#A3A3A3] hover:text-[#B0FAFF] hover:bg-[#B0FAFF]/5',
                    collapsed && !isOpen && 'justify-center px-0'
                  )}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  {(!collapsed || isOpen) && <span className="font-medium">{item.label}</span>}
                </Link>
              </TooltipTrigger>
              {collapsed && !isOpen && <TooltipContent side="right">{item.label}</TooltipContent>}
            </Tooltip>
          )
        })}
      </nav>

      {/* Collapse Toggle - Only visible on Desktop */}
      <div className="hidden lg:block p-3 border-t border-[#1A1A1A]">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCollapsed}
          className={cn(
            'w-full text-[#737373] hover:text-white hover:bg-[#0A0A0A]',
            collapsed && 'justify-center px-0'
          )}
        >
          {collapsed ? (
            <ChevronRight className="w-4 h-4" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4" />
              <span className="ml-2">Collapse</span>
            </>
          )}
        </Button>
      </div>

      <div className={cn('p-3 border-t border-[#1A1A1A]', collapsed && !isOpen && 'flex justify-center')}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
          {(!collapsed || isOpen) && <span className="text-sm text-[#737373]">Agent Online</span>}
        </div>
      </div>
    </>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [isOpen, setIsOpen] = useState(false)

  const handleNewChat = () => {
    setIsOpen(false)
    router.push(`/?new=${Date.now()}`)
  }

  return (
    <TooltipProvider delayDuration={0}>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-16 bg-black border-b border-[#1A1A1A] flex items-center px-4 z-40">
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-white hover:bg-[#0A0A0A]">
              <Menu className="w-6 h-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0 flex flex-col gap-0 text-white border-r border-[#1A1A1A] cyber-gradient">
            <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
            <NavContent
              collapsed={collapsed}
              isOpen={isOpen}
              pathname={pathname}
              onNewChat={handleNewChat}
              onClose={() => setIsOpen(false)}
              onToggleCollapsed={() => setCollapsed((value) => !value)}
            />
          </SheetContent>
        </Sheet>
        <div className="ml-3 flex items-center gap-2">
          <div className="w-6 h-6 bg-[#B0FAFF] rounded flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-black" />
          </div>
          <span className="font-semibold text-white">Qubic Agent</span>
        </div>
      </div>

      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden lg:flex fixed left-0 top-0 h-screen border-r border-[#1A1A1A] flex-col transition-all duration-300 z-40 cyber-gradient bg-dots',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <NavContent
          collapsed={collapsed}
          isOpen={isOpen}
          pathname={pathname}
          onNewChat={handleNewChat}
          onClose={() => setIsOpen(false)}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
        />
      </aside>
    </TooltipProvider>
  )
}
