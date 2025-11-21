export function renderStars(score) {
    const fullStars = Math.floor(score);
    const halfStar = score % 1 >= 0.5 ? 1 : 0;
    const emptyStars = 5 - fullStars - halfStar;
    let starsHtml = '';
    for (let i = 0; i < fullStars; i++) starsHtml += '<i class="fas fa-star"></i>';
    if (halfStar) starsHtml += '<i class="fas fa-star-half-alt"></i>';
    for (let i = 0; i < emptyStars; i++) starsHtml += '<i class="far fa-star"></i>';
    return `<div class="text-yellow-400 text-sm">${starsHtml}</div>`;
}

export function renderProductCard(product, isProductInWishlist) {
    const averageRating = product.averageRating || 0;
    const ratingCount = product.ratingCount || 0;
    const isInWishlist = isProductInWishlist(product.id);
    const isOutOfStock = !product.stock || product.stock <= 0;
    const imageUrl = (product.images && product.images[0]) || product.image;

    const urgencyMessage = !isOutOfStock && product.showUrgency ? `<span class="ml-2 text-sm text-yellow-400 animate-pulse">⚡ Poucas unidades!</span>` : '';

    const addToCartButton = isOutOfStock
        ? `<button class="btn btn-disabled !p-3" disabled aria-label="${product.name} está fora de stock"><i class="fas fa-times-circle text-lg"></i></button>`
        : `<button class="btn btn-primary !p-3 add-to-cart-btn" data-id="${product.id}" aria-label="Adicionar ${product.name} ao carrinho"><i class="fas fa-shopping-cart text-lg"></i></button>`;

    const quickViewButton = isOutOfStock
        ? `<button class="w-full btn btn-accent text-sm notify-me-btn" data-id="${product.id}"><i class="fas fa-bell mr-2"></i> Notificar-me</button>`
        : `<button class="w-full btn btn-secondary text-sm quick-view-btn" data-id="${product.id}">Vista Rápida ${urgencyMessage}</button>`;

    return `
    <div class="bg-background rounded-lg overflow-hidden shadow-lg product-card flex flex-col h-full relative" data-id="${product.id}">
        ${isOutOfStock ? '<div class="absolute top-2 left-2 bg-red-600 text-white text-xs font-bold px-2 py-1 rounded-md z-10">ESGOTADO</div>' : ''}
        <button class="wishlist-btn ${isInWishlist ? 'active' : ''}" data-id="${product.id}" aria-label="Adicionar ${product.name} à wishlist">
            <i class="fa-heart ${isInWishlist ? 'fa-solid' : 'fa-regular'}"></i>
        </button>
        <a href="#/product-detail?id=${product.id}" class="block bg-background product-image-container">
            <div class="aspect-square w-full">
                <img src="${imageUrl}" alt="${product.name}" class="w-full h-full object-contain product-image ${isOutOfStock ? 'opacity-50' : ''}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/600x600/1a1a1a/e11d48?text=Indisponível';this.alt='Imagem de produto indisponível.'">
            </div>
        </a>
        <div class="p-4 flex flex-col flex-grow">
            <div class="flex-grow">
                <h3 class="text-lg font-semibold mb-1 h-12">${product.name}</h3>
                <p class="text-sm text-gray-400">${product.category.charAt(0).toUpperCase() + product.category.slice(1).replace(/-/g, ' ')}</p>
                 <div class="flex items-center mt-2">
                    ${renderStars(averageRating)}
                    <span class="ml-2 text-gray-400 text-xs">(${ratingCount} avaliações)</span>
                </div>
            </div>
            <div class="mt-4">
                <div class="flex justify-between items-center mb-4">
                    <span class="bg-secondary text-accent font-bold py-2 px-4 rounded-md text-lg">€${product.price.toFixed(2)}</span>
                    ${addToCartButton}
                </div>
                ${quickViewButton}
            </div>
        </div>
    </div>`;
}

export function renderAllProducts(products, isProductInWishlist) {
    const container = document.getElementById('product-grid');
    if (!container) return;
    container.innerHTML = products.length > 0 ? products.map(p => renderProductCard(p, isProductInWishlist)).join('') : `<p class="text-gray-400 col-span-full text-center">Nenhum produto encontrado.</p>`;
}
