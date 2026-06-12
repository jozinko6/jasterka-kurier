import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, createSession, getSession, deleteSession, authenticateRequest } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Chýbajú povinné polia: email, heslo' },
        { status: 400 }
      )
    }

    // Find user by email
    const user = await db.user.findUnique({
      where: { email },
    })

    if (!user) {
      return NextResponse.json(
        { error: 'Neplatný email alebo heslo' },
        { status: 401 }
      )
    }

    // Verify password using bcrypt
    if (!user.passwordHash) {
      return NextResponse.json(
        { error: 'Neplatný email alebo heslo' },
        { status: 401 }
      )
    }

    const isValid = await verifyPassword(password, user.passwordHash)
    if (!isValid) {
      return NextResponse.json(
        { error: 'Neplatný email alebo heslo' },
        { status: 401 }
      )
    }

    if (!user.isActive) {
      return NextResponse.json(
        { error: 'Účet nie je aktívny' },
        { status: 403 }
      )
    }

    // Create session token
    const token = createSession(user.id, user.role)

    // Return user info with token
    const result = {
      token,
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
      },
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Error during login:', error)
    return NextResponse.json(
      { error: 'Prihlásenie zlyhalo' },
      { status: 500 }
    )
  }
}

// GET /api/auth - Verify token and return current user
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request)

    if ('error' in authResult) {
      return authResult.error
    }

    return NextResponse.json({
      user: authResult.user,
    })
  } catch (error) {
    console.error('Error verifying token:', error)
    return NextResponse.json(
      { error: 'Overenie zlyhalo' },
      { status: 500 }
    )
  }
}

// DELETE /api/auth - Logout (invalidate session)
export async function DELETE(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization')
    const token = authHeader?.replace('Bearer ', '')

    if (token) {
      deleteSession(token)
    }

    return NextResponse.json({ message: 'Odhlásené' })
  } catch (error) {
    console.error('Error during logout:', error)
    return NextResponse.json(
      { error: 'Odhlásenie zlyhalo' },
      { status: 500 }
    )
  }
}
