'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';

interface StockEntry {
  stockLevelId: string;
  warehouseId: string;
  warehouseName: string;
  warehouseLocation: string;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
}

interface Product {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  price: number;
  imageUrl: string | null;
  stock: StockEntry[];
}

function StockBadge({ available }: { available: number }) {
  if (available === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
        Out of stock
      </span>
    );
  }
  if (available <= 3) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-full">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block animate-pulse" />
        Only {available} left
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-full">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
      {available} in stock
    </span>
  );
}

function ReserveModal({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const router = useRouter();
  const [selectedStock, setSelectedStock] = useState<StockEntry | null>(
    product.stock.find((s) => s.availableUnits > 0) ?? null
  );
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableStock = product.stock.filter((s) => s.availableUnits > 0);

  async function handleReserve() {
    if (!selectedStock) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          warehouseId: selectedStock.warehouseId,
          quantity,
        }),
      });

      const data = await res.json();

      if (res.status === 409) {
        setError(data.error ?? 'Not enough stock available. Someone else may have just reserved the last units.');
        return;
      }
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        return;
      }

      router.push(`/reservations/${data.reservation.id}`);
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-stone-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-slide-up">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h3 className="font-display text-xl font-semibold text-stone-900" style={{ fontFamily: 'Fraunces, serif' }}>
              Reserve units
            </h3>
            <p className="text-sm text-stone-500 mt-0.5">{product.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Warehouse selection */}
        <div className="mb-4">
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
            Fulfil from warehouse
          </label>
          {availableStock.length === 0 ? (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
              No stock available across any warehouse.
            </p>
          ) : (
            <div className="space-y-2">
              {availableStock.map((s) => (
                <label
                  key={s.warehouseId}
                  className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                    selectedStock?.warehouseId === s.warehouseId
                      ? 'border-stone-900 bg-stone-50'
                      : 'border-stone-200 hover:border-stone-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        selectedStock?.warehouseId === s.warehouseId
                          ? 'border-stone-900'
                          : 'border-stone-300'
                      }`}
                    >
                      {selectedStock?.warehouseId === s.warehouseId && (
                        <div className="w-2 h-2 rounded-full bg-stone-900" />
                      )}
                    </div>
                    <input
                      type="radio"
                      className="sr-only"
                      name="warehouse"
                      checked={selectedStock?.warehouseId === s.warehouseId}
                      onChange={() => setSelectedStock(s)}
                    />
                    <div>
                      <p className="text-sm font-medium text-stone-900">{s.warehouseName}</p>
                      <p className="text-xs text-stone-400">{s.warehouseLocation}</p>
                    </div>
                  </div>
                  <StockBadge available={s.availableUnits} />
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Quantity */}
        {selectedStock && (
          <div className="mb-5">
            <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
              Quantity
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-9 h-9 rounded-lg border border-stone-200 flex items-center justify-center text-stone-600 hover:border-stone-400 transition-colors"
              >
                −
              </button>
              <span className="font-mono text-lg font-medium text-stone-900 w-8 text-center">
                {quantity}
              </span>
              <button
                onClick={() =>
                  setQuantity((q) => Math.min(q + 1, selectedStock.availableUnits))
                }
                className="w-9 h-9 rounded-lg border border-stone-200 flex items-center justify-center text-stone-600 hover:border-stone-400 transition-colors"
              >
                +
              </button>
            </div>
          </div>
        )}

        {/* Price */}
        {selectedStock && (
          <div className="flex items-center justify-between mb-5 pt-4 border-t border-stone-100">
            <span className="text-sm text-stone-500">Total</span>
            <span className="font-display text-xl font-semibold text-stone-900" style={{ fontFamily: 'Fraunces, serif' }}>
              ₹{(product.price * quantity).toLocaleString('en-IN')}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-start gap-2">
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            {error}
          </div>
        )}

        <button
          onClick={handleReserve}
          disabled={!selectedStock || loading || availableStock.length === 0}
          className="w-full py-3 px-4 bg-stone-900 text-white font-medium text-sm rounded-xl hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              Reserving...
            </>
          ) : (
            <>
              Reserve — 10 min hold
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 7h10M8 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </>
          )}
        </button>

        <p className="text-xs text-stone-400 text-center mt-3">
          No charge until you confirm checkout
        </p>
      </div>
    </div>
  );
}

function ProductCard({
  product,
  onReserve,
}: {
  product: Product;
  onReserve: (p: Product) => void;
}) {
  const totalAvailable = product.stock.reduce((sum, s) => sum + s.availableUnits, 0);

  return (
    <article className="bg-white rounded-2xl border border-stone-200 overflow-hidden hover:shadow-md hover:border-stone-300 transition-all group animate-fade-in">
      {/* Image */}
      <div className="aspect-[4/3] bg-stone-100 overflow-hidden relative">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="text-stone-300">
              <rect x="4" y="4" width="10" height="10" rx="2" fill="currentColor" />
              <rect x="18" y="4" width="10" height="10" rx="2" fill="currentColor" opacity="0.6" />
              <rect x="4" y="18" width="10" height="10" rx="2" fill="currentColor" opacity="0.6" />
              <rect x="18" y="18" width="10" height="10" rx="2" fill="currentColor" opacity="0.3" />
            </svg>
          </div>
        )}
        <div className="absolute top-3 right-3">
          <StockBadge available={totalAvailable} />
        </div>
      </div>

      {/* Details */}
      <div className="p-5">
        <div className="mb-3">
          <p className="text-xs font-mono text-stone-400 mb-1">{product.sku}</p>
          <h2
            className="font-display text-lg font-semibold text-stone-900 leading-snug"
            style={{ fontFamily: 'Fraunces, serif' }}
          >
            {product.name}
          </h2>
          {product.description && (
            <p className="text-sm text-stone-500 mt-1.5 line-clamp-2">{product.description}</p>
          )}
        </div>

        {/* Per-warehouse stock */}
        <div className="mb-4 space-y-1.5">
          {product.stock.map((s) => (
            <div key={s.warehouseId} className="flex items-center justify-between text-xs">
              <span className="text-stone-500 truncate pr-2">{s.warehouseName}</span>
              <span
                className={`font-mono font-medium tabular-nums ${
                  s.availableUnits === 0
                    ? 'text-stone-300'
                    : s.availableUnits <= 3
                    ? 'text-amber-600'
                    : 'text-stone-700'
                }`}
              >
                {s.availableUnits} avail
              </span>
            </div>
          ))}
        </div>

        {/* Price & CTA */}
        <div className="flex items-center justify-between">
          <span
            className="font-display text-xl font-semibold text-stone-900"
            style={{ fontFamily: 'Fraunces, serif' }}
          >
            ₹{product.price.toLocaleString('en-IN')}
          </span>
          <button
            onClick={() => onReserve(product)}
            disabled={totalAvailable === 0}
            className="py-2 px-4 bg-stone-900 text-white text-sm font-medium rounded-lg hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {totalAvailable === 0 ? 'Unavailable' : 'Reserve'}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await fetch('/api/products', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load products');
      const data = await res.json();
      setProducts(data.products);
      setLastRefreshed(new Date());
      setError(null);
    } catch (err) {
      setError('Could not load products. Please refresh.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
    // Refresh stock every 30 seconds
    const interval = setInterval(fetchProducts, 2000);
    return () => clearInterval(interval);
  }, [fetchProducts]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-stone-500">Loading inventory...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10 6v4.5M10 13h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-stone-700 font-medium mb-2">Failed to load</p>
          <p className="text-sm text-stone-500 mb-4">{error}</p>
          <button
            onClick={fetchProducts}
            className="text-sm font-medium text-stone-900 underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Page header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1
            className="font-display text-3xl sm:text-4xl font-semibold text-stone-900 mb-2"
            style={{ fontFamily: 'Fraunces, serif' }}
          >
            All Products
          </h1>
          <p className="text-stone-500 text-sm">
            {products.length} product{products.length !== 1 ? 's' : ''} across{' '}
            {new Set(products.flatMap((p) => p.stock.map((s) => s.warehouseId))).size} warehouses
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastRefreshed && (
            <p className="text-xs text-stone-400 font-mono hidden sm:block">
              Updated {lastRefreshed.toLocaleTimeString()}
            </p>
          )}
          <button
            onClick={fetchProducts}
            className="p-2 rounded-lg border border-stone-200 text-stone-500 hover:text-stone-900 hover:border-stone-300 transition-all"
            title="Refresh stock"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M1 7a6 6 0 1 1 1 3.5M1 10.5V7H4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Products grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {products.map((product, i) => (
          <div key={product.id} style={{ animationDelay: `${i * 60}ms` }}>
            <ProductCard product={product} onReserve={setSelectedProduct} />
          </div>
        ))}
      </div>

      {/* Modals */}
      {selectedProduct && (
        <ReserveModal product={selectedProduct} onClose={() => setSelectedProduct(null)} />
      )}
    </>
  );
}
