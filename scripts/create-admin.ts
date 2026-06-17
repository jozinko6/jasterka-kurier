/**
 * Production admin bootstrap script.
 *
 * Creates a single admin account using the ADMIN_BOOTSTRAP_PASSWORD env var.
 * Safe to run in production — does NOT use weak demo passwords.
 *
 * Usage:
 *   ADMIN_BOOTSTRAP_EMAIL=admin@yourdomain.sk \
 *   ADMIN_BOOTSTRAP_PASSWORD=<secure-password> \
 *   bunx tsx scripts/create-admin.ts
 *
 * The password is never logged. If the account already exists, the script
 * exits without changes (idempotent).
 */

import { PrismaClient, UserRole } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD

  if (!email || !password) {
    console.error('❌ ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD environment variables are required.')
    console.error('   Example:')
    console.error('   ADMIN_BOOTSTRAP_EMAIL=admin@yourdomain.sk ADMIN_BOOTSTRAP_PASSWORD=... bunx tsx scripts/create-admin.ts')
    process.exit(1)
  }

  if (password.length < 12) {
    console.error('❌ ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters.')
    process.exit(1)
  }

  // Idempotent: if admin already exists, exit
  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log(`✓ Admin account ${email} already exists. No changes made.`)
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)
  await prisma.user.create({
    data: {
      email,
      role: UserRole.ADMIN,
      passwordHash,
      isActive: true,
    },
  })

  console.log(`✅ Admin account created: ${email}`)
  console.log('   The password was NOT logged. Store it in a password manager.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
