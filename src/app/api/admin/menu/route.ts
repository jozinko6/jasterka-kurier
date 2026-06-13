import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decimalToNumber } from '@/lib/decimal-utils'
import { requireRole } from '@/lib/auth'
import { createMenuItemSchema, updateMenuItemSchema, validateBody } from '@/lib/validations'

export async function POST(request: NextRequest) {
  try {
    // Only admins can create menu items
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const body = await request.json()

    // Validate input
    const validation = validateBody(createMenuItemSchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    // Check slug uniqueness
    const existing = await db.menuItem.findUnique({ where: { slug: data.slug } })
    if (existing) {
      return NextResponse.json(
        { error: 'Slug už existuje' },
        { status: 409 }
      )
    }

    const menuItem = await db.menuItem.create({
      data: {
        categoryId: data.categoryId,
        slug: data.slug,
        name: data.name,
        description: data.description || null,
        basePrice: data.basePrice,
        imageUrl: data.imageUrl || null,
        isActive: data.isActive ?? true,
        isFeatured: data.isFeatured ?? false,
        isAvailable: data.isAvailable ?? true,
        preparationTimeMinutes: data.preparationTimeMinutes ?? null,
      },
      include: {
        category: true,
        options: { orderBy: { sortOrder: 'asc' } },
      },
    })

    return NextResponse.json(decimalToNumber(menuItem), { status: 201 })
  } catch (error) {
    console.error('Error creating menu item:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa vytvoriť položku menu' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Only admins can update menu items
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const body = await request.json()

    // Validate input
    const validation = validateBody(updateMenuItemSchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    // Verify menu item exists
    const existing = await db.menuItem.findUnique({ where: { id: data.id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Položka menu nenájdená' },
        { status: 404 }
      )
    }

    // Build update data from allowed fields
    const { id, ...fields } = data
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
      if (fields[field as keyof typeof fields] !== undefined) {
        if (field === 'basePrice') {
          updateData[field] = fields[field as keyof typeof fields]
        } else {
          updateData[field] = fields[field as keyof typeof fields]
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

    return NextResponse.json(decimalToNumber(updatedMenuItem))
  } catch (error) {
    console.error('Error updating menu item:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa aktualizovať položku menu' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const { id } = await request.json()
    if (!id || typeof id !== 'string') {
      return NextResponse.json(
        { error: 'ID položky menu je povinné' },
        { status: 400 }
      )
    }

    const existing = await db.menuItem.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Položka menu nenájdená' },
        { status: 404 }
      )
    }

    const orderItemCount = await db.orderItem.count({
      where: { menuItemId: id },
    })

    if (orderItemCount > 0) {
      const updatedMenuItem = await db.menuItem.update({
        where: { id },
        data: { isActive: false, isAvailable: false },
        include: {
          category: true,
          options: { orderBy: { sortOrder: 'asc' } },
        },
      })

      return NextResponse.json({
        item: decimalToNumber(updatedMenuItem),
        deactivated: true,
      })
    }

    await db.menuItem.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error('Error deleting menu item:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa odobrať položku menu' },
      { status: 500 }
    )
  }
}
