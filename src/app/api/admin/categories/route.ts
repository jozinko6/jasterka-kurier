import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
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

    return NextResponse.json(categories)
  } catch (error) {
    console.error('Error fetching categories:', error)
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { slug, name, description, sortOrder, isActive, isDailyMenu, imageUrl } = body

    if (!slug || !name) {
      return NextResponse.json(
        { error: 'Missing required fields: slug, name' },
        { status: 400 }
      )
    }

    // Check slug uniqueness
    const existing = await db.menuCategory.findUnique({ where: { slug } })
    if (existing) {
      return NextResponse.json(
        { error: 'Slug already exists' },
        { status: 409 }
      )
    }

    const category = await db.menuCategory.create({
      data: {
        slug,
        name,
        description: description || null,
        sortOrder: sortOrder ?? 0,
        isActive: isActive ?? true,
        isDailyMenu: isDailyMenu ?? false,
        imageUrl: imageUrl || null,
      },
      include: {
        menuItems: true,
      },
    })

    return NextResponse.json(category, { status: 201 })
  } catch (error) {
    console.error('Error creating category:', error)
    return NextResponse.json(
      { error: 'Failed to create category' },
      { status: 500 }
    )
  }
}
