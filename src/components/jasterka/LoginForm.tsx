'use client'

import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, LogIn } from 'lucide-react'

interface LoginFormProps {
  requiredRole?: string[]
  title?: string
  description?: string
  onSuccess?: () => void
}

export function LoginForm({
  requiredRole,
  title = 'Prihlásenie',
  description = 'Zadajte svoje prihlasovacie údaje',
  onSuccess,
}: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const { login } = useAuthStore()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsLoading(true)

    try {
      const user = await login(email, password)

      if (requiredRole && !requiredRole.includes(user.role)) {
        setError(`Táto stránka vyžaduje rolu: ${requiredRole.join(', ')}`)
        return
      }

      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prihlásenie zlyhalo')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: '#f8f9fa' }}>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 h-12 w-12 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
            <LogIn className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="vas@email.sk"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Heslo</Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full text-white"
              style={{ backgroundColor: '#4f7f2a' }}
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Prihlasujem...
                </>
              ) : (
                'Prihlásiť sa'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
