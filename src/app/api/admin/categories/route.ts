import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decimalToNumber } from '@/lib/decimal-utils'
import { requireRole } from '@/lib/auth'
import { createCategorySchema, validateBody } from '@/lib/validations'

export async function GET(request: NextRequest) {
  try {
    // Admin-only category management view
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const categories = await db.menuCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        menuItems: {
          orderBy: { name: 'asc' },
          include: {
            options: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    })

    return NextResponse.json(decimalToNumber(categories))
  } catch (error) {
    console.error('Error fetching categories:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa načítať kategórie' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Only admins can create categories
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const body = await request.json()

    // Validate input
    const validation = validateBody(createCategorySchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    // Check slug uniqueness
    const existing = await db.menuCategory.findUnique({ where: { slug: data.slug } })
    if (existing) {
      return NextResponse.json(
        { error: 'Slug už existuje' },
        { status: 409 }
      )
    }

    const category = await db.menuCategory.create({
      data: {
        slug: data.slug,
        name: data.name,
        description: data.description || null,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
        isDailyMenu: data.isDailyMenu ?? false,
        imageUrl: data.imageUrl || null,
      },
      include: {
        menuItems: true,
      },
    })

    return NextResponse.json(decimalToNumber(category), { status: 201 })
  } catch (error) {
    console.error('Error creating category:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa vytvoriť kategóriu' },
      { status: 500 }
    )
  }
}
