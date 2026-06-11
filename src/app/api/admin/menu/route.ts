import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      categoryId,
      slug,
      name,
      description,
      basePrice,
      imageUrl,
      isActive,
      isFeatured,
      isAvailable,
      preparationTimeMinutes,
    } = body

    if (!categoryId || !slug || !name || basePrice === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: categoryId, slug, name, basePrice' },
        { status: 400 }
      )
    }

    // Check slug uniqueness
    const existing = await db.menuItem.findUnique({ where: { slug } })
    if (existing) {
      return NextResponse.json(
        { error: 'Slug already exists' },
        { status: 409 }
      )
    }

    const menuItem = await db.menuItem.create({
      data: {
        categoryId,
        slug,
        name,
        description: description || null,
        basePrice: parseFloat(String(basePrice)),
        imageUrl: imageUrl || null,
        isActive: isActive ?? true,
        isFeatured: isFeatured ?? false,
        isAvailable: isAvailable ?? true,
        preparationTimeMinutes: preparationTimeMinutes ?? null,
      },
      include: {
        category: true,
        options: { orderBy: { sortOrder: 'asc' } },
      },
    })

    return NextResponse.json(menuItem, { status: 201 })
  } catch (error) {
    console.error('Error creating menu item:', error)
    return NextResponse.json(
      { error: 'Failed to create menu item' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, ...fields } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Missing required field: id' },
        { status: 400 }
      )
    }

    // Verify menu item exists
    const existing = await db.menuItem.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Menu item not found' },
        { status: 404 }
      )
    }

    // Build update data from allowed fields
    const allowedFields = [
      'categoryId',
      'slug',
      'name',
      'description',
      'basePrice',
      'imageUrl',
      'isActive',
      'isFeatured',
      'isAvailable',
      'preparationTimeMinutes',
    ]

    const updateData: Record<string, unknown> = {}
    for (const field of allowedFields) {
      if (fields[field] !== undefined) {
        if (field === 'basePrice') {
          updateData[field] = parseFloat(String(fields[field]))
        } else {
          updateData[field] = fields[field]
        }
      }
    }

    const updatedMenuItem = await db.menuItem.update({
      where: { id },
      data: updateData,
      include: {
        category: true,
        options: { orderBy: { sortOrder: 'asc' } },
      },
    })

    return NextResponse.json(updatedMenuItem)
  } catch (error) {
    console.error('Error updating menu item:', error)
    return NextResponse.json(
      { error: 'Failed to update menu item' },
      { status: 500 }
    )
  }
}
