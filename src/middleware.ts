import { NextRequest, NextResponse } from 'next/server'
import { checkOrigin } from '@/lib/csrf'

/**
 * Next.js middleware — runs on every request.
 *
 * For mutation requests (POST/PUT/PATCH/DELETE) using cookie auth,
 * validates the Origin header to prevent CSRF.
 *
 * Bearer token requests (QA/API scripts) are exempt.
 */
export function middleware(request: NextRequest) {
  // Only check /api/* routes
  if (!request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  const originCheck = checkOrigin(request)
  if (!originCheck.ok) {
    return originCheck.response
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
