import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { releaseExpiredReservations } from '@/lib/expiry';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Lazy cleanup: release expired reservations before computing stock
    await releaseExpiredReservations();

    const products = await prisma.product.findMany({
      orderBy: { name: 'asc' },
      include: {
        stockLevels: {
          include: {
            warehouse: true,
          },
        },
      },
    });

    const result = products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      sku: p.sku,
      price: p.price,
      imageUrl: p.imageUrl,
      stock: p.stockLevels.map((sl) => ({
        stockLevelId: sl.id,
        warehouseId: sl.warehouseId,
        warehouseName: sl.warehouse.name,
        warehouseLocation: sl.warehouse.location,
        totalUnits: sl.totalUnits,
        reservedUnits: sl.reservedUnits,
        availableUnits: sl.totalUnits - sl.reservedUnits,
      })),
    }));

    return NextResponse.json({ products: result });
  } catch (error) {
    console.error('[GET /api/products]', error);

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}