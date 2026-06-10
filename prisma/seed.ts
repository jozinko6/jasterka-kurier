import { PrismaClient, UserRole, VehicleType, CourierStatus, MenuItemOptionType } from '@prisma/client'
import { hash } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database for Pizza Jašterka...')

  // ─── Clean up ───
  await prisma.kitchenEvent.deleteMany()
  await prisma.courierEarning.deleteMany()
  await prisma.deliveryAssignment.deleteMany()
  await prisma.orderStatusHistory.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.order.deleteMany()
  await prisma.menuItemOption.deleteMany()
  await prisma.menuItem.deleteMany()
  await prisma.menuCategory.deleteMany()
  await prisma.openingHours.deleteMany()
  await prisma.restaurantSettings.deleteMany()
  await prisma.deliveryZone.deleteMany()
  await prisma.courier.deleteMany()
  await prisma.customer.deleteMany()
  await prisma.user.deleteMany()

  // ─── Users ───
  const adminUser = await prisma.user.create({
    data: {
      email: 'admin@jasterka.sk',
      role: UserRole.ADMIN,
      passwordHash: hashPassword('admin123'),
      isActive: true,
    },
  })

  const kitchenUser = await prisma.user.create({
    data: {
      email: 'kuchyna@jasterka.sk',
      role: UserRole.KITCHEN,
      passwordHash: hashPassword('kuchyna123'),
      isActive: true,
    },
  })

  const courierBikeUser = await prisma.user.create({
    data: {
      email: 'kurier.bicykel@jasterka.sk',
      phone: '+421900111222',
      role: UserRole.COURIER,
      passwordHash: hashPassword('kurier123'),
      isActive: true,
    },
  })

  const courierCarUser = await prisma.user.create({
    data: {
      email: 'kurier.auto@jasterka.sk',
      phone: '+421900333444',
      role: UserRole.COURIER,
      passwordHash: hashPassword('kurier123'),
      isActive: true,
    },
  })

  const customerUser = await prisma.user.create({
    data: {
      email: 'zakaznik@jasterka.sk',
      phone: '+421900555666',
      role: UserRole.CUSTOMER,
      passwordHash: hashPassword('zakaznik123'),
      isActive: true,
    },
  })

  // ─── Customers ───
  await prisma.customer.create({
    data: {
      userId: customerUser.id,
      fullName: 'Ján Novák',
      defaultNote: 'Prosím volať pri príchode',
    },
  })

  // ─── Couriers ───
  const courierBike = await prisma.courier.create({
    data: {
      userId: courierBikeUser.id,
      displayName: 'Miro Bicykel',
      phone: '+421900111222',
      vehicleType: VehicleType.BICYCLE,
      status: CourierStatus.OFFLINE,
      isActive: true,
    },
  })

  const courierCar = await prisma.courier.create({
    data: {
      userId: courierCarUser.id,
      displayName: 'Peter Auto',
      phone: '+421900333444',
      vehicleType: VehicleType.CAR,
      status: CourierStatus.OFFLINE,
      isActive: true,
    },
  })

  // ─── Menu Categories ───
  const catPizza = await prisma.menuCategory.create({
    data: {
      slug: 'pizza',
      name: 'Pizza',
      description: 'Čerstvá pizza z drevenej pece',
      sortOrder: 1,
      isActive: true,
      isDailyMenu: false,
    },
  })

  const catDailyMenu = await prisma.menuCategory.create({
    data: {
      slug: 'denne-menu',
      name: 'Denné menu',
      description: 'Denné menu od 10:00 do 14:00',
      sortOrder: 2,
      isActive: true,
      isDailyMenu: true,
    },
  })

  const catJedla = await prisma.menuCategory.create({
    data: {
      slug: 'jedla',
      name: 'Jedlá',
      description: 'Teplé jedlá',
      sortOrder: 3,
      isActive: true,
      isDailyMenu: false,
    },
  })

  const catNapojne = await prisma.menuCategory.create({
    data: {
      slug: 'napoje',
      name: 'Nápoje',
      description: 'Osviežujúce nápoje',
      sortOrder: 4,
      isActive: true,
      isDailyMenu: false,
    },
  })

  const catPrilohy = await prisma.menuCategory.create({
    data: {
      slug: 'prilohy',
      name: 'Prílohy',
      description: 'Prílohy a omáčky',
      sortOrder: 5,
      isActive: true,
      isDailyMenu: false,
    },
  })

  const catAkcie = await prisma.menuCategory.create({
    data: {
      slug: 'akcie',
      name: 'Akcie',
      description: 'Aktuálne akcie',
      sortOrder: 6,
      isActive: true,
      isDailyMenu: false,
    },
  })

  // ─── Menu Items ───
  const pizzaMargherita = await prisma.menuItem.create({
    data: {
      categoryId: catPizza.id,
      slug: 'pizza-margherita',
      name: 'Pizza Margherita',
      description: 'Paradajková omáčka, mozzarella, bazalka',
      basePrice: 7.90,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 15,
    },
  })

  const pizzaSunkova = await prisma.menuItem.create({
    data: {
      categoryId: catPizza.id,
      slug: 'pizza-sunkova',
      name: 'Pizza Šunková',
      description: 'Paradajková omáčka, mozzarella, šunka',
      basePrice: 8.90,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 15,
    },
  })

  const pizzaGazdovsky = await prisma.menuItem.create({
    data: {
      categoryId: catPizza.id,
      slug: 'pizza-gazdovska',
      name: 'Pizza Gazdovská',
      description: 'Paradajková omáčka, mozzarella, šunka, huby, paprika, cibuľa',
      basePrice: 9.90,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 18,
    },
  })

  const pizzaPikantna = await prisma.menuItem.create({
    data: {
      categoryId: catPizza.id,
      slug: 'pizza-pikantna',
      name: 'Pizza Pikantná',
      description: 'Paradajková omáčka, mozzarella, saláma, jalapeňo, čili',
      basePrice: 9.50,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 15,
    },
  })

  // Pizza options
  const pizzaItems = [pizzaMargherita, pizzaSunkova, pizzaGazdovsky, pizzaPikantna]
  for (const pizza of pizzaItems) {
    // Sizes
    await prisma.menuItemOption.createMany({
      data: [
        {
          menuItemId: pizza.id,
          optionGroup: 'Veľkosť',
          optionType: MenuItemOptionType.SIZE,
          name: '32 cm',
          priceDelta: 0,
          isDefault: true,
          isRequired: true,
          sortOrder: 1,
        },
        {
          menuItemId: pizza.id,
          optionGroup: 'Veľkosť',
          optionType: MenuItemOptionType.SIZE,
          name: '40 cm',
          priceDelta: 2.50,
          isDefault: false,
          isRequired: false,
          sortOrder: 2,
        },
      ],
    })

    // Extra ingredients
    const extras = [
      { name: 'Extra syr', price: 1.20 },
      { name: 'Šunka', price: 1.40 },
      { name: 'Slanina', price: 1.60 },
      { name: 'Jalapeňo', price: 0.90 },
      { name: 'Nduja', price: 1.70 },
      { name: 'Huby', price: 1.10 },
      { name: 'Olivy', price: 1.00 },
      { name: 'Kukurica', price: 0.80 },
    ]
    await prisma.menuItemOption.createMany({
      data: extras.map((e, i) => ({
        menuItemId: pizza.id,
        optionGroup: 'Extra suroviny',
        optionType: MenuItemOptionType.EXTRA,
        name: e.name,
        priceDelta: e.price,
        isDefault: false,
        isRequired: false,
        sortOrder: i + 1,
      })),
    })

    // Remove ingredients
    const removes = ['Bazalka', 'Cibuľa', 'Paprika', 'Šunka', 'Huby']
    await prisma.menuItemOption.createMany({
      data: removes.map((r, i) => ({
        menuItemId: pizza.id,
        optionGroup: 'Bez suroviny',
        optionType: MenuItemOptionType.REMOVE,
        name: `Bez ${r.toLowerCase()}`,
        priceDelta: 0,
        isDefault: false,
        isRequired: false,
        sortOrder: i + 1,
      })),
    })
  }

  // Daily menus
  const dailyMenu1 = await prisma.menuItem.create({
    data: {
      categoryId: catDailyMenu.id,
      slug: 'denne-menu-1',
      name: 'Denné menu 1',
      description: 'Polievka + Pizza Margherita 32 cm + Kofola 0.33l',
      basePrice: 7.50,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 20,
    },
  })

  const dailyMenu2 = await prisma.menuItem.create({
    data: {
      categoryId: catDailyMenu.id,
      slug: 'denne-menu-2',
      name: 'Denné menu 2',
      description: 'Polievka + Pizza Šunková 32 cm + Kofola 0.33l',
      basePrice: 7.90,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 20,
    },
  })

  // Jedlá
  await prisma.menuItem.create({
    data: {
      categoryId: catJedla.id,
      slug: 'grilovane-kuracie-prsia',
      name: 'Grilované kuracie prsia',
      description: 'Kuracie prsia na grile s ryžou a zeleninovým šalátom',
      basePrice: 8.70,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 20,
    },
  })

  // Nápoje
  await prisma.menuItem.create({
    data: {
      categoryId: catNapojne.id,
      slug: 'kofola',
      name: 'Kofola 0.33l',
      description: 'Kofola originál',
      basePrice: 2.20,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 0,
    },
  })

  await prisma.menuItem.create({
    data: {
      categoryId: catNapojne.id,
      slug: 'mineralka',
      name: 'Minerálka 0.5l',
      description: 'Budiš minerálna voda',
      basePrice: 1.80,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 0,
    },
  })

  // Prílohy
  await prisma.menuItem.create({
    data: {
      categoryId: catPrilohy.id,
      slug: 'cesnakovy-dip',
      name: 'Cesnakový dip',
      description: 'Domáci cesnakový dip',
      basePrice: 1.20,
      isActive: true,
      isAvailable: true,
      preparationTimeMinutes: 0,
    },
  })

  // Akcie
  await prisma.menuItem.create({
    data: {
      categoryId: catAkcie.id,
      slug: 'akcia-tyzdna',
      name: 'Akcia týždňa',
      description: 'Pizza Gazdovská 40 cm + Kofola za výhodnú cenu',
      basePrice: 8.40,
      isActive: true,
      isAvailable: true,
      isFeatured: true,
      preparationTimeMinutes: 18,
    },
  })

  // ─── Delivery Zones ───
  const zoneCentrum = await prisma.deliveryZone.create({
    data: {
      name: 'Hlohovec centrum',
      deliveryFee: 1.50,
      minimumOrderAmount: 8.00,
      estimatedDeliveryMinutes: 25,
      allowedVehicleTypes: 'BICYCLE,SCOOTER,CAR',
      isActive: true,
      priority: 1,
    },
  })

  const zoneSirsieCentrum = await prisma.deliveryZone.create({
    data: {
      name: 'Hlohovec širšie centrum',
      deliveryFee: 2.00,
      minimumOrderAmount: 10.00,
      estimatedDeliveryMinutes: 30,
      allowedVehicleTypes: 'BICYCLE,SCOOTER,CAR',
      isActive: true,
      priority: 2,
    },
  })

  await prisma.deliveryZone.create({
    data: {
      name: 'Súľkovo',
      deliveryFee: 2.50,
      minimumOrderAmount: 12.00,
      estimatedDeliveryMinutes: 35,
      allowedVehicleTypes: 'SCOOTER,CAR',
      isActive: true,
      priority: 3,
    },
  })

  await prisma.deliveryZone.create({
    data: {
      name: 'Leopoldov',
      deliveryFee: 3.00,
      minimumOrderAmount: 14.00,
      estimatedDeliveryMinutes: 40,
      allowedVehicleTypes: 'CAR',
      isActive: true,
      priority: 4,
    },
  })

  await prisma.deliveryZone.create({
    data: {
      name: 'Koplotovce',
      deliveryFee: 3.00,
      minimumOrderAmount: 14.00,
      estimatedDeliveryMinutes: 40,
      allowedVehicleTypes: 'CAR',
      isActive: true,
      priority: 5,
    },
  })

  await prisma.deliveryZone.create({
    data: {
      name: 'Bojničky',
      deliveryFee: 3.00,
      minimumOrderAmount: 14.00,
      estimatedDeliveryMinutes: 40,
      allowedVehicleTypes: 'CAR',
      isActive: true,
      priority: 6,
    },
  })

  await prisma.deliveryZone.create({
    data: {
      name: 'Okolie individuálne',
      deliveryFee: 0,
      minimumOrderAmount: 0,
      estimatedDeliveryMinutes: 60,
      allowedVehicleTypes: 'CAR',
      isActive: false,
      priority: 7,
    },
  })

  // ─── Sample Order ───
  const sampleOrder = await prisma.order.create({
    data: {
      orderNumber: 'JAS-1001',
      status: 'NEW',
      orderType: 'DELIVERY',
      paymentMethod: 'CASH',
      paymentStatus: 'PENDING',
      customerName: 'Ján Novák',
      customerPhone: '+421900555666',
      customerEmail: 'zakaznik@jasterka.sk',
      deliveryZoneId: zoneCentrum.id,
      deliveryAddressLine1: 'Hlavná 12',
      deliveryCity: 'Hlohovec',
      deliveryNote: 'Prosím volať pri príchode',
      kitchenNote: '',
      subtotalAmount: 7.90,
      deliveryFee: 1.50,
      totalAmount: 9.40,
    },
  })

  await prisma.orderItem.create({
    data: {
      orderId: sampleOrder.id,
      menuItemId: pizzaMargherita.id,
      menuItemNameSnapshot: 'Pizza Margherita',
      quantity: 1,
      basePriceSnapshot: 7.90,
      unitTotalSnapshot: 7.90,
      lineTotal: 7.90,
      selectedSize: '32 cm',
      selectedOptions: null,
    },
  })

  await prisma.orderStatusHistory.create({
    data: {
      orderId: sampleOrder.id,
      status: 'NEW',
      changedByUserId: customerUser.id,
    },
  })

  // ─── Restaurant Settings ───
  await prisma.restaurantSettings.create({
    data: {
      deliveryEnabled: true,
      pickupEnabled: true,
      isOpen: true,
      customerMessage: 'Vitajte v Pizza Jašterka! 🦎',
      averagePrepMinutes: 30,
      minimumOrderAmount: 8.00,
      storePhone: '+421900123456',
      storeAddress: 'Hlavná 45, 920 01 Hlohovec',
    },
  })

  // ─── Opening Hours ───
  await prisma.openingHours.createMany({
    data: [
      { dayOfWeek: 1, openTime: '10:00', closeTime: '21:00', isClosed: false },
      { dayOfWeek: 2, openTime: '10:00', closeTime: '21:00', isClosed: false },
      { dayOfWeek: 3, openTime: '10:00', closeTime: '21:00', isClosed: false },
      { dayOfWeek: 4, openTime: '10:00', closeTime: '21:00', isClosed: false },
      { dayOfWeek: 5, openTime: '10:00', closeTime: '22:00', isClosed: false },
      { dayOfWeek: 6, openTime: '11:00', closeTime: '22:00', isClosed: false },
      { dayOfWeek: 0, openTime: '11:00', closeTime: '20:00', isClosed: false },
    ],
  })

  console.log('✅ Seed complete!')
  console.log(`   Users: ${await prisma.user.count()}`)
  console.log(`   Categories: ${await prisma.menuCategory.count()}`)
  console.log(`   Menu Items: ${await prisma.menuItem.count()}`)
  console.log(`   Options: ${await prisma.menuItemOption.count()}`)
  console.log(`   Zones: ${await prisma.deliveryZone.count()}`)
  console.log(`   Orders: ${await prisma.order.count()}`)
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const cryptoModule = require('crypto')

function hashPassword(password: string): string {
  // Simple hash for development - in production use bcrypt
  return cryptoModule.createHash('sha256').update(password).digest('hex')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
