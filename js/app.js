import { functions } from "./firebase.js";
import { auth, db, storage } from './firebase.js';
import { onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { doc, getDoc, setDoc, collection, getDocs, addDoc, query, where, deleteDoc, updateDoc, writeBatch, serverTimestamp, orderBy, runTransaction, limit } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-functions.js";
import { renderAllProducts, renderProductCard, renderStars } from './modules/ui.js';
import { getFirebaseErrorMessage, logout } from './modules/auth.js';
import { on } from './modules/events.js';
const importAliExpressProduct = httpsCallable(functions, "importAliExpressProduct");

// TODO: Lançamento: Substitua esta chave pela sua chave do site reCAPTCHA de produção
const RECAPTCHA_SITE_KEY = '6LeJXJIrAAAAAMh4x_AG8ZJH_RmdIJ50MICzriCi';
// TODO: Lançamento: Substitua este ID pelo seu ID de acompanhamento do Google Analytics de produção
const GOOGLE_ANALYTICS_ID = 'G-2NSFKWXG77';
// TODO: Lançamento: Substitua esta chave pela sua chave pública do Stripe de produção e considere movê-la para uma variável de ambiente
const STRIPE_PUBLIC_KEY = 'pk_test_51RyHuf42pRHAcenNzc5G5jckCpZFPtsHSLhBpM2QmwXRfnikV2FuEhqwEN18GPmd3V81yNyypdnGHaPh3uV1au1p002LQ5jyFk';


function startCountdown(endTime, elementId) {
    const countdownElement = document.getElementById(elementId);
    if (!countdownElement) {
        console.error(`Countdown element with id "${elementId}" not found.`);
        return;
    }

    // Store the interval ID so we can clear it.
    let intervalId = null;

    const updateTimer = () => {
        const now = new Date().getTime();
        const distance = endTime - now;

        if (distance < 0) {
            clearInterval(intervalId);
            countdownElement.innerHTML = `<div class="text-lg font-bold text-red-500">PROMOÇÃO TERMINOU</div>`;
            return;
        }

        const days = Math.floor(distance / (1000 * 60 * 60 * 24));
        const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((distance % (1000 * 60)) / 1000);

        let html = '';

        // Dynamically build the countdown HTML based on the remaining time
        if (days > 0) {
            html = `
                <div class="countdown-item"><span>${days}</span><span class="text-xs">Dias</span></div>
                <div class="countdown-item"><span>${hours}</span><span class="text-xs">Horas</span></div>
                <div class="countdown-item"><span>${minutes}</span><span class="text-xs">Min</span></div>
                <div class="countdown-item"><span>${seconds}</span><span class="text-xs">Seg</span></div>
            `;
        } else if (hours > 0) {
            html = `
                <div class="countdown-item"><span>${hours}</span><span class="text-xs">Horas</span></div>
                <div class="countdown-item"><span>${minutes}</span><span class="text-xs">Min</span></div>
                <div class="countdown-item"><span>${seconds}</span><span class="text-xs">Seg</span></div>
            `;
        } else if (minutes > 0) {
            html = `
                <div class="countdown-item"><span>${minutes}</span><span class="text-xs">Min</span></div>
                <div class="countdown-item"><span>${seconds}</span><span class="text-xs">Seg</span></div>
            `;
        } else {
            html = `
                <div class="countdown-item"><span>${seconds}</span><span class="text-xs">Seg</span></div>
            `;
        }
        countdownElement.innerHTML = html;
    };

    // Initial call to display immediately, then set interval.
    updateTimer();
    intervalId = setInterval(updateTimer, 1000);
}

const app = {
    products: [], cart: [], user: null, userProfile: null,
    orders: [], allOrders: [], authReady: false, checkoutStep: 1,
    exitIntentShown: false,
    adminImageFiles: [], // Stores new File objects for upload
    adminExistingImages: [], // Stores existing image URLs for the product being edited
    translations: {},
    filters: { category: 'all', minPrice: 0, maxPrice: 0, brand: [], color: [], material: [] },
    filteredProducts: [],
    currentPage: 1,
    productsPerPage: 12,
    discount: { code: '', percentage: 0, amount: 0 },
    loyalty: { pointsUsed: 0, discountAmount: 0 },
    stripe: null, stripeElements: null, paymentIntentClientSecret: null,
    routes: {
        '/': 'home', '/products': 'products', '/search': 'search', '/product-detail': 'product-detail',
        '/cart': 'cart', '/checkout': 'checkout', '/account': 'account',
        '/about': 'about', '/contact': 'contact', '/terms': 'terms',
        '/privacy': 'privacy', '/faq': 'faq', '/admin': 'admin', '/admin-orders': 'admin',
        '/admin-reviews': 'admin', '/wishlist': 'account',
    },

    debounce(func, delay) {
        let timeout;
        return function(...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), delay);
        };
    },

    async init() {
        this.auth = auth;
        this.db = db;
        this.storage = storage;
        this.functions = getFunctions(auth.app, 'europe-west3');

        // Basic setup that doesn't depend on auth or page content
        this.initStripe();
        this.initCookieConsent();
        this.initThemeSwitcher();
        this.initLanguageSwitcher();

        // Age gate must be handled before starting the main app logic
        this.initAgeGate(); // This will call startApp()
    },

    initStripe() {
        if (typeof Stripe === 'undefined') {
            console.error('Stripe.js not loaded');
            return;
        }
        try {
            // Initialize Stripe. If the key is a placeholder, this will fail.
            this.stripe = Stripe(STRIPE_PUBLIC_KEY);
        } catch (error) {
            console.error("Failed to initialize Stripe, likely due to a placeholder key. Payment functionality will be disabled.", error.message);
            this.stripe = null; // Ensure stripe is null if initialization fails
        }
    },

    initThemeSwitcher() {
        const themeToggleBtn = document.getElementById('theme-toggle-btn');
        if (!themeToggleBtn) return;

        const moonIcon = document.getElementById('theme-icon-moon');
        const sunIcon = document.getElementById('theme-icon-sun');
        const docElement = document.documentElement;

        const applyTheme = (theme) => {
            if (theme === 'light') {
                docElement.setAttribute('data-theme', 'light');
                if(moonIcon) moonIcon.classList.add('hidden');
                if(sunIcon) sunIcon.classList.remove('hidden');
            } else {
                docElement.removeAttribute('data-theme');
                if(moonIcon) moonIcon.classList.remove('hidden');
                if(sunIcon) sunIcon.classList.add('hidden');
            }
        };

        const savedTheme = localStorage.getItem('theme') || 'dark';
        applyTheme(savedTheme);

        themeToggleBtn.addEventListener('click', () => {
            const currentTheme = docElement.hasAttribute('data-theme') ? 'light' : 'dark';
            const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
            localStorage.setItem('theme', newTheme);
            applyTheme(newTheme);
        });
    },

    async loadTranslations(lang = 'pt') {
        try {
            const response = await fetch(`locales/${lang}.json`);
            if (!response.ok) {
                throw new Error(`Could not load translation file for ${lang}`);
            }
            this.translations = await response.json();
            document.documentElement.lang = lang;
            return true;
        } catch (error) {
            console.error("Translation loading error:", error);
            // Fallback to Portuguese if the selected language fails
            if (lang !== 'pt') {
                return await this.loadTranslations('pt');
            }
            return false;
        }
    },

    applyTranslations() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (this.translations[key]) {
                el.textContent = this.translations[key];
            }
        });
        document.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.dataset.i18nHtml;
            if (this.translations[key]) {
                el.innerHTML = this.translations[key];
            }
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            if (this.translations[key]) {
                el.placeholder = this.translations[key];
            }
        });
        document.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.dataset.i18nAria;
            if (this.translations[key]) {
                el.setAttribute('aria-label', this.translations[key]);
            }
        });
    },

    async initLanguageSwitcher() {
        const switcherBtn = document.getElementById('lang-switcher-btn');
        const dropdown = document.getElementById('lang-dropdown');
        const currentLangText = document.getElementById('current-lang-text');

        if (!switcherBtn || !dropdown || !currentLangText) return;

        const setLanguage = async (lang) => {
            await this.loadTranslations(lang);
            this.applyTranslations();
            localStorage.setItem('language', lang);
            currentLangText.textContent = lang.toUpperCase();
            dropdown.classList.add('hidden');
        };

        switcherBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('hidden');
        });

        document.addEventListener('click', () => {
            if (!dropdown.classList.contains('hidden')) {
                dropdown.classList.add('hidden');
            }
        });

        dropdown.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const lang = link.dataset.lang;
                const currentLang = localStorage.getItem('language') || 'pt';
                if (lang && lang !== currentLang) {
                    setLanguage(lang);
                } else {
                    dropdown.classList.add('hidden');
                }
            });
        });

        const savedLang = localStorage.getItem('language') || 'pt';
        await setLanguage(savedLang);
    },

    async startApp() {
        this.addEventListeners();
        await this.handleAuthState(); // Auth is now ready

        // Check for Stripe redirect URL params now that auth is complete
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('payment_intent_client_secret')) {
            await this.handlePostPayment(urlParams);
            // Clean up URL to prevent reprocessing on refresh
            window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
        }

        await this.loadProducts();
        await this.renderPage();
    },

    initAgeGate() {
        const modal = document.getElementById('age-gate-modal');
        if (sessionStorage.getItem('ageVerified')) {
            modal.classList.replace('flex', 'hidden');
            this.startApp();
        } else {
            modal.classList.replace('hidden', 'flex');
            document.getElementById('age-gate-enter').addEventListener('click', () => {
                sessionStorage.setItem('ageVerified', 'true');
                modal.classList.replace('flex', 'hidden');
                this.startApp();
            }, { once: true });

            document.getElementById('age-gate-exit').addEventListener('click', () => {
                document.body.innerHTML = `<div class="h-screen w-screen flex items-center justify-center text-white text-2xl bg-black p-4 text-center">Lamentamos, mas tem de ter 18 anos ou mais para aceder a este site.</div>`;
            }, { once: true });
        }
    },

    initCookieConsent() {
        const banner = document.getElementById('cookie-consent-banner');
        const acceptBtn = document.getElementById('cookie-accept-btn');
        const declineBtn = document.getElementById('cookie-decline-btn');
        const consent = localStorage.getItem('cookie_consent');

        if (consent === 'true') {
            this.initializeAnalytics();
        } else if (!consent) {
            banner.style.display = 'flex';
        }

        acceptBtn.addEventListener('click', () => {
            localStorage.setItem('cookie_consent', 'true');
            banner.style.display = 'none';
            this.initializeAnalytics();
        });

        declineBtn.addEventListener('click', () => {
            localStorage.setItem('cookie_consent', 'false');
            banner.style.display = 'none';
        });
    },

    initializeAnalytics() {
        if (typeof gtag === 'function' && GOOGLE_ANALYTICS_ID) {
            gtag('config', GOOGLE_ANALYTICS_ID);
        }
    },

    handleAuthState() {
        return new Promise(resolve => {
            onAuthStateChanged(this.auth, async (user) => {
                const wasJustGuest = !this.user && user;
                this.user = user;

                if (user) {
                    await this.loadUserProfile();
                    await this.loadCartFromFirestore();

                    if (wasJustGuest) {
                        const guestCart = this.loadCartFromLocalStorage();
                        if (guestCart.length > 0) {
                            await this.mergeCarts(guestCart);
                            localStorage.removeItem('guestCart');
                        }
                    }
                } else {
                    this.userProfile = null;
                    this.cart = this.loadCartFromLocalStorage();
                }

                this.updateAuthUI(!!user);
                this.updateCartCountDisplay();

                if (!this.authReady) {
                    this.authReady = true;
                    resolve();
                }
            },
            (error) => {
                console.error("Erro no estado de autenticação:", error);
                if (!this.authReady) {
                    this.authReady = true;
                    resolve();
                }
            });
        });
    },

    addEventListeners() {
        if (this.eventsInitialized) return;

        on('auth:logout_success', () => {
            this.showToast('Sessão terminada com sucesso!');
            this.navigateTo('/');
        });
        on('error:auth', (error) => {
            this.showToast(error.message, 'error');
        });

        document.body.addEventListener('click', (e) => {
            const target = e.target;
            const closest = (selector) => target.closest(selector);

            if (closest('.add-to-cart-btn')) {
                e.preventDefault();
                const button = closest('.add-to-cart-btn');
                const productId = button.dataset.id;
                const price = button.dataset.price || null;
                this.addToCart(productId, price);
            }
            else if (closest('.quick-view-btn')) this.openPreviewModal(closest('.quick-view-btn').dataset.id);
            else if (closest('.quantity-change')) this.updateCartQuantity(closest('[data-id]').dataset.id, closest('.quantity-change').dataset.action);
            else if (closest('.remove-item')) this.removeFromCart(closest('[data-id]').dataset.id);
            // Delegated search listeners must come before the generic link handler
            else if (closest('#search-icon')) { this.openSearch(); }
            else if (closest('#close-search-btn')) { this.closeSearch(); }
            else if (closest('.search-suggestion-item')) {
                // This handles both product items and category links.
                // For categories, we close immediately. For products, we add a small delay.
                if (closest('a').href.includes('/products?category=')) {
                    this.closeSearch();
                } else {
                    setTimeout(() => this.closeSearch(), 50);
                }
            }
             else if (closest('#search-suggestions a.block')) {
                // This specifically targets the "See all results" link.
                // We can close it immediately, navigation will still occur.
                this.closeSearch();
            }
            else if (closest('a[href^="#/"]') && !closest('.search-suggestion-item') && !e.target.closest('a').target) { e.preventDefault(); this.navigateTo(new URL(e.target.closest('a').href).hash.substring(1)); }
            else if (closest('#login-btn')) this.openAuthModal('login');
            else if (closest('.category-filter-btn')) { e.preventDefault(); this.handleCategoryFilterClick(closest('.category-filter-btn')); }
            else if (closest('.accordion-header')) this.toggleAccordion(closest('.accordion-header'));
            else if (closest('.admin-order-details-btn')) this.openAdminOrderDetailModal(closest('.admin-order-details-btn').dataset.id);
            else if (closest('#close-admin-order-modal-btn')) this.closeAdminOrderDetailModal();
            else if (closest('#submit-review-btn')) { e.preventDefault(); this.submitProductRating(closest('#submit-review-btn').dataset.productId); }
            else if (closest('.order-item-image')) { e.preventDefault(); this.showImageInModal(e.target.dataset.imageUrl); }
            else if (closest('#apply-discount-btn')) { e.preventDefault(); this.applyDiscount(); }
            else if (closest('#apply-loyalty-points-btn')) { e.preventDefault(); this.applyLoyaltyPoints(); }
            else if (closest('#sidebar-apply-discount-btn')) { e.preventDefault(); this.applyDiscountSidebar(); }
            else if (closest('.wishlist-btn')) { e.preventDefault(); this.toggleWishlist(closest('.wishlist-btn').dataset.id); }
            else if (closest('.flash-sale-btn')) { this.openFlashSaleModal(closest('.flash-sale-btn').dataset.id); }
            else if (closest('.add-bundle-to-cart-btn')) {
                e.preventDefault();
                this.addBundleToCart(closest('.add-bundle-to-cart-btn').dataset.productId);
            }
            else if (closest('.notify-me-btn')) {
                e.preventDefault();
                this.openNotifyMeModal(closest('.notify-me-btn').dataset.id);
            }
             else if (closest('#bottom-nav-cart')) {
                e.preventDefault();
                this.openCartSidebar();
            }
        });

        // Use a separate listener for clicks that should close the search, to avoid conflicts.
        document.addEventListener('click', (e) => {
            const searchOverlay = document.getElementById('search-overlay');
            // If the search is closed, do nothing.
            if (!searchOverlay || searchOverlay.classList.contains('hidden')) {
                return;
            }

            const searchContainer = searchOverlay.querySelector('.relative');
            const clickedInsideSearch = searchContainer && searchContainer.contains(e.target);
            const clickedOnSearchIcon = e.target.closest('#search-icon');

            // If the click is outside the search area and not on the icon that opens it, close.
            if (!clickedInsideSearch && !clickedOnSearchIcon) {
                this.closeSearch();
            }
        });

    document.body.addEventListener('change', (e) => {
        if (e.target.classList.contains('advanced-filter-checkbox')) {
            const filterType = e.target.dataset.filterType;
            const value = e.target.value;
            if (e.target.checked) {
                this.filters[filterType].push(value);
            } else {
                this.filters[filterType] = this.filters[filterType].filter(item => item !== value);
            }
            this.applyFilters();
        }
    });

        window.addEventListener('hashchange', () => this.renderPage());
        this.initSearch();
        this.initMobileMenu();
        this.initNewsletterForm();
        this.initCartSidebar();
        this.initExitIntentPopup();
        this.eventsInitialized = true;
    },

    handleCategoryFilterClick(btn) {
        document.querySelectorAll('.category-filter-btn').forEach(b => b.classList.remove('text-accent', 'font-bold'));
        btn.classList.add('text-accent', 'font-bold');
        this.filters.category = btn.dataset.category;
        this.applyFilters();
    },

    navigateTo(path) {
        if(window.location.hash.substring(1) !== path) {
            window.location.hash = path;
        } else {
            this.renderPage();
        }
        this.trackEvent('page_view', { page_path: path });
    },

    async getTemplate(pageId) {
        // This is a simple cache to avoid re-fetching templates.
        if (!this.templates) this.templates = {};
        if (this.templates[pageId]) return this.templates[pageId];

        try {
            const response = await fetch(`templates/${pageId}.html`);
            if (!response.ok) {
                throw new Error(`Could not fetch template for ${pageId}`);
            }
            const templateText = await response.text();

            // Create a temporary element to parse the HTML string
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = templateText;

            // Store the parsed content
            this.templates[pageId] = tempDiv;
            return tempDiv;
        } catch (error) {
            console.error("Template loading error:", error);
            return null;
        }
    },

    async renderPage() {
        if (!this.authReady) return;

        this.showLoading();
        const url = window.location.hash.substring(1) || '/';
        const [path, query] = url.split('?');

        const protectedRoutes = ['/account', '/checkout'];
        const adminRoutes = ['/admin', '/admin-orders', '/admin-reviews'];

        if (protectedRoutes.includes(path) && !this.user) {
            this.showToast('Por favor, faça login para aceder a esta página.', 'error');
            this.navigateTo('/'); this.openAuthModal('login'); this.hideLoading(); return;
        }

        if (adminRoutes.includes(path) && !(this.userProfile?.isAdmin)) {
            this.showToast('Acesso negado. Apenas administradores.', 'error');
            this.navigateTo('/'); this.hideLoading(); return;
        }

        const pageId = this.routes[path] || '404';
        const root = document.getElementById('app-root');

        const templateContent = await this.getTemplate(pageId);

        if (templateContent) {
            root.innerHTML = '';
            root.appendChild(templateContent.cloneNode(true));
            window.scrollTo(0, 0);

            await this.runPageSpecificScripts(path, new URLSearchParams(query));
            this.updateActiveNav(path);
            this.applyTranslations();
        } else {
            // Fallback for failed template load
            root.innerHTML = `<h2 class="text-center text-2xl py-20">Erro ao carregar a página.</h2>`;
        }
        this.hideLoading();
    },

    updateActiveNav(path) {
        // Top header and mobile slide-out menu
        document.querySelectorAll('#main-nav .nav-link, #mobile-menu .nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.route === path);
        });

        // Bottom navigation bar
        document.querySelectorAll('#bottom-nav .bottom-nav-link').forEach(link => {
            // Special handling for account and its sub-pages (wishlist, etc.)
            if (link.dataset.route === '/account' && path.startsWith('/account')) {
                link.classList.add('active');
            } else {
                link.classList.toggle('active', link.dataset.route === path);
            }
        });

        // Also, hide redundant icons in the header on mobile
        const isMobile = window.innerWidth < 768;
        const cartIconHeader = document.getElementById('cart-icon-container');
        const authContainerHeader = document.getElementById('auth-container');

        if (isMobile) {
            if (cartIconHeader) cartIconHeader.style.display = 'none';
            if (authContainerHeader) authContainerHeader.style.display = 'none';
        } else {
            if (cartIconHeader) cartIconHeader.style.display = 'flex';
            if (authContainerHeader) authContainerHeader.style.display = 'flex';
        }
    },

    async runPageSpecificScripts(path, params) {
        // Atualiza as meta tags para cada página
        this.updateMetaTagsForPage(path, params);

        switch (path) {
            case '/': await this.initHomePage(); break;
            case '/products': this.initProductsPage(params); break;
            case '/search': await this.initSearchPage(params); break;
            case '/product-detail': this.renderProductDetail(params.get('id')); break;
            case '/cart': this.renderCartPage(); break;
            case '/checkout': this.checkoutStep = 1; this.renderCheckoutPage(params); break;
            case '/contact': this.initContactForm(); break;
            case '/faq': /* Accordion handled globally */ break;
            case '/account': await this.initAccountPage(params.get('tab') || 'dashboard'); break;
            case '/admin': await this.initAdminPage('products'); break;
            case '/admin-orders': await this.initAdminPage('orders'); break;
            case '/admin-reviews': await this.initAdminPage('reviews'); break;
        }
    },

    async initAdminPage(tab) {
        this.updateAdminNav(tab);
        if (tab === 'products') await this.initAdminProductsPage();
        else if (tab === 'orders') await this.initAdminOrdersPage();
        else if (tab === 'reviews') await this.initAdminReviewsPage();
    },

    updateAdminNav(activeTab) {
        const navLinks = document.querySelectorAll('#admin-nav a');
        navLinks.forEach(link => {
            link.classList.remove('bg-accent', 'text-white');
            if (link.href.includes('/admin-orders') && activeTab === 'orders') {
                link.classList.add('bg-accent', 'text-white');
            } else if (link.href.includes('/admin-reviews') && activeTab === 'reviews') {
                link.classList.add('bg-accent', 'text-white');
            } else if (link.href.includes('#/admin') && !link.href.includes('orders') && !link.href.includes('reviews') && activeTab === 'products') {
                link.classList.add('bg-accent', 'text-white');
            }
        });
    },

    async initHomePage() {
        this.initHeroCarousel();
        this.initFeaturedProductCarousel();
        await this.renderTestimonials();
        this.initTestimonialsCarousel();
    this.renderRecentlyViewed();
        this.animateHomePageElements();
        this.initFlashSale();
    },

    initTestimonialsCarousel() {
        const carousel = document.getElementById('testimonials-container');
        const prevBtn = document.getElementById('testimonials-prev');
        const nextBtn = document.getElementById('testimonials-next');
        if (!carousel || !prevBtn || !nextBtn) return;

        const updateCarouselButtons = () => {
            const maxScrollLeft = carousel.scrollWidth - carousel.clientWidth;
            prevBtn.style.display = carousel.scrollLeft > 0 ? 'flex' : 'none';
            nextBtn.style.display = carousel.scrollLeft < maxScrollLeft -1 ? 'flex' : 'none';
        };

        carousel.addEventListener('scroll', updateCarouselButtons);
        nextBtn.addEventListener('click', () => carousel.scrollBy({ left: carousel.clientWidth, behavior: 'smooth' }));
        prevBtn.addEventListener('click', () => carousel.scrollBy({ left: -carousel.clientWidth, behavior: 'smooth' }));

        setTimeout(updateCarouselButtons, 100); // Initial check
    },

    initHeroCarousel() {
        const carousel = document.getElementById('hero-carousel');
        if (!carousel) return;

        const slides = carousel.querySelectorAll('.hero-slide');
        const prevBtn = document.getElementById('hero-carousel-prev');
        const nextBtn = document.getElementById('hero-carousel-next');
        const indicatorsContainer = document.getElementById('hero-carousel-indicators');
        let currentSlide = 0;
        let slideInterval;

        if (slides.length <= 1) {
            if(slides.length === 1) slides[0].classList.replace('opacity-0', 'opacity-100');
            if(prevBtn) prevBtn.style.display = 'none';
            if(nextBtn) nextBtn.style.display = 'none';
            return;
        }

        // Create indicators
        slides.forEach((_, index) => {
            const dot = document.createElement('button');
            dot.classList.add('hero-dot', 'w-3', 'h-3', 'rounded-full', 'bg-white', 'bg-opacity-50', 'transition-all', 'duration-300');
            dot.setAttribute('aria-label', `Ir para o slide ${index + 1}`);
            dot.dataset.slideTo = index;
            indicatorsContainer.appendChild(dot);
        });

        const dots = indicatorsContainer.querySelectorAll('.hero-dot');

        function showSlide(index) {
            // Animate out the current slide's content
            const currentText = slides[currentSlide].querySelector('.max-w-xl');
            if (currentText) currentText.classList.add('opacity-0');

            slides.forEach((slide, i) => {
                slide.classList.toggle('opacity-100', i === index);
                slide.classList.toggle('opacity-0', i !== index);
                slide.classList.toggle('z-10', i === index);
                slide.classList.toggle('z-0', i !== index);
            });
            dots.forEach((dot, i) => {
                dot.classList.toggle('bg-opacity-100', i === index);
                dot.classList.toggle('scale-125', i === index);
                dot.classList.toggle('bg-opacity-50', i !== index);
            });
            currentSlide = index;

            // Animate in the new slide's content
            const newText = slides[currentSlide].querySelector('.max-w-xl');
            if (newText) {
                setTimeout(() => newText.classList.remove('opacity-0'), 200); // Delay to sync with slide transition
            }
        }

        function next() {
            showSlide((currentSlide + 1) % slides.length);
        }

        function prev() {
            showSlide((currentSlide - 1 + slides.length) % slides.length);
        }

        function startSlideShow() {
            stopSlideShow();
            slideInterval = setInterval(next, 7000); // 7 seconds interval
        }

        function stopSlideShow() {
            clearInterval(slideInterval);
        }

        nextBtn.addEventListener('click', () => { next(); startSlideShow(); });
        prevBtn.addEventListener('click', () => { prev(); startSlideShow(); });

        dots.forEach(dot => {
            dot.addEventListener('click', (e) => {
                const slideIndex = parseInt(e.target.dataset.slideTo);
                showSlide(slideIndex);
                startSlideShow();
            });
        });

        const section = document.getElementById('hero-carousel-section');
        section.addEventListener('mouseenter', stopSlideShow);
        section.addEventListener('mouseleave', startSlideShow);

        // Animate in the first slide's text
        slides.forEach(slide => {
           const textContent = slide.querySelector('.max-w-xl');
           if (textContent) textContent.classList.add('opacity-0', 'transition-opacity', 'duration-500');
        });

        showSlide(0);
        startSlideShow();
    },

    initProductsPage(params) {
        const searchTerm = params.get('q');
        if (searchTerm) {
            const searchInput = document.getElementById('search-input');
            if (searchInput) searchInput.value = searchTerm;
        }
        const sort = params.get('sort');
        if (sort) {
            const sortSelect = document.getElementById('sort');
            if (sortSelect) sortSelect.value = sort;
        }

        this.initFilters(params);
        this.applyFilters(true); // Pass true to avoid URL update on initial load
        this.initProductSorting();
    },


    animateHomePageElements() {
        const elements = document.querySelectorAll('.fade-in, .fade-in-up');
        elements.forEach(el => {
            el.style.animation = 'none';
            el.offsetHeight;
            el.style.animation = null;
        });
    },

    initFeaturedProductCarousel() {
        const carousel = document.getElementById('featured-carousel');
        const prevBtn = document.getElementById('carousel-prev');
        const nextBtn = document.getElementById('carousel-next');
        if (!carousel || !prevBtn || !nextBtn) return;

        const featuredProducts = [...this.products]
            .sort((a, b) => (b.sold || 0) - (a.sold || 0))
            .slice(0, 8);
        carousel.innerHTML = featuredProducts.map(p => `<div class="snap-start shrink-0 w-80">${renderProductCard(p, this.isProductInWishlist.bind(this))}</div>`).join('');

        const updateCarouselButtons = () => {
            const maxScrollLeft = carousel.scrollWidth - carousel.clientWidth;
            prevBtn.style.display = carousel.scrollLeft > 0 ? 'flex' : 'none';
            nextBtn.style.display = carousel.scrollLeft < maxScrollLeft -1 ? 'flex' : 'none';
        };

        prevBtn.classList.add('carousel-nav-btn');
        nextBtn.classList.add('carousel-nav-btn');

        carousel.addEventListener('scroll', updateCarouselButtons);
        nextBtn.addEventListener('click', () => carousel.scrollBy({ left: carousel.clientWidth * 0.8, behavior: 'smooth' }));
        prevBtn.addEventListener('click', () => carousel.scrollBy({ left: -carousel.clientWidth * 0.8, behavior: 'smooth' }));

        setTimeout(updateCarouselButtons, 100);
    },

    async renderTestimonials() {
        const container = document.getElementById('testimonials-container');
        if (!container) return;

        try {
            const q = query(
                collection(this.db, "product_ratings"),
                where("status", "==", "approved"),
                where("score", ">=", 4),
                orderBy("createdAt", "desc"),
                limit(9) // Load more for the carousel
            );
            const querySnapshot = await getDocs(q);
            const reviews = querySnapshot.docs.map(doc => doc.data());

            if (reviews.length > 2) { // Need at least 3 for a carousel to make sense
                container.innerHTML = reviews.map(review => {
                    const author = review.userName || 'Anónimo';
                    const avatarId = author.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
                    const avatar = `https://i.pravatar.cc/150?u=${avatarId}`;
                    const quote = review.comment || 'Excelente produto! Recomendo vivamente.';

                    return `
                    <div class="snap-start shrink-0 w-full md:w-1/3 p-4">
                        <div class="bg-primary p-8 rounded-lg text-center h-full flex flex-col justify-center">
                            <p class="text-gray-300 italic mb-6">"${quote}"</p>
                            <div class="flex items-center justify-center">
                                <img src="${avatar}" alt="Avatar de ${author}" class="w-12 h-12 rounded-full mr-4" loading="lazy">
                                <span class="font-bold text-white">${author}</span>
                            </div>
                        </div>
                    </div>`;
                }).join('');
            } else {
                this.renderStaticTestimonials();
            }
        } catch (error) {
            console.error("Error loading dynamic testimonials:", error);
            this.renderStaticTestimonials();
        }
    },

    renderStaticTestimonials() {
        const container = document.getElementById('testimonials-container');
        if (!container) return;
        const testimonials = [
            { quote: "Uma experiência de compra incrível. Discreto, rápido e os produtos são de uma qualidade excecional. Recomendo vivamente!", author: "Ana S.", avatar: "https://i.pravatar.cc/150?u=a042581f4e29026704d" },
            { quote: "Finalmente uma loja online com classe e produtos que valem a pena. A minha vida a dois agradece. O site é super fácil de navegar.", author: "Marco P.", avatar: "https://i.pravatar.cc/150?u=a042581f4e29026705d" },
            { quote: "Fiquei impressionada com a atenção ao detalhe, desde a embalagem discreta ao apoio ao cliente. Sentimo-nos valorizados.", author: "Sofia L.", avatar: "https://i.pravatar.cc/150?u=a042581f4e29026706d" }
        ];
        container.innerHTML = testimonials.map(t => `
            <div class="snap-start shrink-0 w-full md:w-1/3 p-4">
                <div class="bg-primary p-8 rounded-lg text-center h-full flex flex-col justify-center">
                    <p class="text-gray-300 italic mb-6">"${t.quote}"</p>
                    <div class="flex items-center justify-center">
                        <img src="${t.avatar}" alt="Avatar de ${t.author}" class="w-12 h-12 rounded-full mr-4" loading="lazy">
                        <span class="font-bold text-white">${t.author}</span>
                    </div>
                </div>
            </div>`).join('');
    },

    renderRecentlyViewed() {
        const section = document.getElementById('recently-viewed-section');
        const carousel = document.getElementById('recently-viewed-carousel');
        const prevBtn = document.getElementById('recently-viewed-prev');
        const nextBtn = document.getElementById('recently-viewed-next');

        if (!section || !carousel || !prevBtn || !nextBtn) return;

        try {
            const recentlyViewedIds = JSON.parse(localStorage.getItem('recentlyViewed')) || [];
            if (recentlyViewedIds.length === 0) {
                section.classList.add('hidden');
                return;
            }

            const viewedProducts = recentlyViewedIds.map(id => this.products.find(p => p.id === id)).filter(Boolean);

            if (viewedProducts.length === 0) {
                section.classList.add('hidden');
                return;
            }

            section.classList.remove('hidden');
            carousel.innerHTML = viewedProducts.map(p => `<div class="snap-start shrink-0 w-80">${renderProductCard(p, this.isProductInWishlist.bind(this))}</div>`).join('');

            const updateCarouselButtons = () => {
                const maxScrollLeft = carousel.scrollWidth - carousel.clientWidth;
                prevBtn.style.display = carousel.scrollLeft > 0 ? 'flex' : 'none';
                nextBtn.style.display = carousel.scrollLeft < maxScrollLeft - 1 ? 'flex' : 'none';
            };

            carousel.addEventListener('scroll', updateCarouselButtons);
            nextBtn.addEventListener('click', () => carousel.scrollBy({ left: carousel.clientWidth * 0.8, behavior: 'smooth' }));
            prevBtn.addEventListener('click', () => carousel.scrollBy({ left: -carousel.clientWidth * 0.8, behavior: 'smooth' }));

            setTimeout(updateCarouselButtons, 100);

        } catch (e) {
            console.error("Could not render recently viewed products", e);
            section.classList.add('hidden');
        }
    },

    async initFlashSale() {
        const saleSection = document.getElementById('flash-sale-section');
        if (!saleSection) return;

        try {
            const saleDoc = await getDoc(doc(this.db, "flash_sale", "current"));
            if (!saleDoc.exists()) {
                saleSection.classList.add('hidden');
                return;
            }

            const saleData = saleDoc.data();
            const endDate = saleData.endDate.toDate();
            const now = new Date();

            if (endDate <= now) {
                saleSection.classList.add('hidden');
                return;
            }

            const product = this.products.find(p => p.id === saleData.productId);
            if (!product) {
                saleSection.classList.add('hidden');
                return;
            }

            const discountedPrice = product.price * (1 - saleData.discountPercentage / 100);

            const saleContainer = document.getElementById('flash-sale-container');
            saleContainer.innerHTML = this.renderFlashSaleProduct(product, discountedPrice, saleData.discountPercentage);
            saleSection.classList.remove('hidden');

            startCountdown(endDate.getTime(), 'promo-countdown');
        } catch (error) {
            console.error("Error loading flash sale:", error);
            saleSection.classList.add('hidden');
        }
    },

    renderFlashSaleProduct(product, discountedPrice, discountPercentage) {
        const imageUrl = (product.images && product.images[0]) || product.image;
        return `
            <a href="#/product-detail?id=${product.id}" class="block bg-primary rounded-lg shadow-lg p-6 flex flex-col md:flex-row items-center gap-8 hover:bg-secondary transition-colors duration-300">
                <div class="md:w-1/3 relative">
                    <img src="${imageUrl}" alt="${product.name}" class="w-full h-auto rounded-md" onerror="this.onerror=null;this.src='https://placehold.co/400x400/1a1a1a/e11d48?text=Indisponível';">
                    <div class="absolute top-0 right-0 bg-accent text-white font-bold py-2 px-4 rounded-bl-lg rounded-tr-lg">-${discountPercentage}%</div>
                </div>
                <div class="md:w-2/3 text-left">
                    <h3 class="text-2xl lg:text-3xl font-bold mb-2">${product.name}</h3>
                    <p class="text-gray-400 mb-4 hidden sm:block">${product.description.substring(0, 120)}...</p>
                    <div class="flex items-baseline gap-4 mb-4">
                        <span class="text-3xl lg:text-4xl font-bold text-accent">€${discountedPrice.toFixed(2)}</span>
                        <span class="text-xl lg:text-2xl text-gray-500 line-through">€${product.price.toFixed(2)}</span>
                    </div>
                    <div class="w-full btn btn-primary add-to-cart-btn" data-id="${product.id}" data-price="${discountedPrice.toFixed(2)}">
                        Aproveitar e Adicionar ao Carrinho
                    </div>
                </div>
            </a>
        `;
    },

    async renderProductDetail(productId) {
        const product = this.products.find(p => p.id === productId);
        const container = document.getElementById('product-detail-content');
        if (!container) return;

        if (product) {
            // Track recently viewed products
            try {
                const MAX_RECENTLY_VIEWED = 10;
                let recentlyViewed = JSON.parse(localStorage.getItem('recentlyViewed')) || [];
                recentlyViewed = recentlyViewed.filter(id => id !== productId); // Remove if already present
                recentlyViewed.unshift(productId); // Add to the front
                if (recentlyViewed.length > MAX_RECENTLY_VIEWED) {
                    recentlyViewed.pop(); // Limit the list size
                }
                localStorage.setItem('recentlyViewed', JSON.stringify(recentlyViewed));
            } catch(e) {
                console.error("Could not update recently viewed products", e);
            }

            this.updateMetaTagsForPage('/product-detail', new URLSearchParams(`id=${productId}`));

            const isOutOfStock = !product.stock || product.stock <= 0;
            const urgencyMessage = !isOutOfStock && product.showUrgency ? `<span class="ml-2 text-yellow-400 animate-pulse">⚡ Poucas unidades!</span>` : '';
            const averageRating = product.averageRating || 0;
            const ratingCount = product.ratingCount || 0;
            const imageList = (product.images && product.images.length > 0) ? product.images : [product.image || 'https://placehold.co/800x800/1a1a1a/e11d48?text=Indisponível'];
            const mainImage = imageList[0];

            const addToCartButtonDetail = isOutOfStock
                ? `<button class="w-full btn btn-accent flex items-center justify-center gap-2 notify-me-btn" data-id="${product.id}">
                       <i class="fas fa-bell"></i> Notificar-me Quando Disponível
                   </button>`
                : `<button data-id="${product.id}" class="add-to-cart-btn w-full btn btn-primary flex items-center justify-center gap-2">
                       <i class="fas fa-shopping-cart"></i> Adicionar ao Carrinho ${urgencyMessage}
                   </button>`;

            let reviewSectionHtml = '';
            if (this.user) {
                try {
                    const canReview = await this.checkIfUserCanReview(productId);
                    if (canReview) {
                        reviewSectionHtml = `
                            <form id="review-form" class="space-y-4">
                                <div>
                                    <label for="review-score" class="block text-gray-300 mb-2">Sua Pontuação:</label>
                                    <select id="review-score" class="form-select w-full p-3 rounded-md bg-secondary border border-gray-600 text-white">
                                        <option value="5">5 Estrelas - Excelente</option>
                                        <option value="4">4 Estrelas - Muito Bom</option>
                                        <option value="3">3 Estrelas - Bom</option>
                                        <option value="2">2 Estrelas - Razoável</option>
                                        <option value="1">1 Estrela - Ruim</option>
                                    </select>
                                </div>
                                <div>
                                    <label for="review-comment" class="block text-gray-300 mb-2">Seu Comentário (opcional):</label>
                                    <textarea id="review-comment" class="form-input w-full p-3 rounded-md" rows="4" placeholder="Escreva seu comentário aqui..."></textarea>
                                </div>
                                <div>
                                    <label class="block text-gray-300 mb-2" for="review-image">Adicionar Foto (opcional)</label>
                                    <input accept="image/*" class="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-accent file:text-black hover:file:bg-pink-400" id="review-image" type="file"/>
                                    <p class="text-xs text-gray-500 mt-1">Apenas fotos da embalagem ou do produto. Não inclua pessoas.</p>
                                </div>
                                <button type="submit" id="submit-review-btn" data-product-id="${product.id}" class="btn btn-primary w-full">Enviar Avaliação</button>
                            </form>`;
                    } else {
                        reviewSectionHtml = `<p class="text-gray-400 bg-secondary p-4 rounded-lg">Só pode avaliar produtos que já comprou. Obrigado pela sua compreensão.</p>`;
                    }
                } catch (error) {
                    console.error("Erro ao verificar a elegibilidade da avaliação. A renderizar a página sem a secção de avaliação.", error);
                    reviewSectionHtml = `<p class="text-gray-400 bg-secondary p-4 rounded-lg">Não foi possível carregar a secção de avaliação.</p>`;
                }
            } else {
                reviewSectionHtml = `
                    <p class="text-gray-400">Faça login para deixar uma avaliação.</p>
                    <button class="btn btn-secondary mt-4" onclick="app.openAuthModal('login')">Login</button>`;
            }

            container.innerHTML = `
                <div class="mb-8">
                    <a href="#/products" class="text-gray-400 hover:text-accent transition-colors duration-300 flex items-center gap-2 w-fit">
                        <i class="fas fa-arrow-left"></i> Voltar aos produtos
                    </a>
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    <div class="relative" id="product-gallery">
                        <button class="wishlist-btn" data-id="${product.id}" aria-label="Adicionar ${product.name} à wishlist">
                           <i class="fa-heart fa-regular"></i>
                        </button>
                        <div class="aspect-w-1 aspect-h-1 w-full bg-secondary rounded-lg flex items-center justify-center mb-4">
                            <img id="main-product-image" src="${mainImage}" alt="${product.name}" class="w-full h-full max-h-[500px] object-contain rounded-lg ${isOutOfStock ? 'opacity-50' : ''}" onerror="this.onerror=null;this.src='https://placehold.co/800x800/1a1a1a/e11d48?text=Indisponível';this.alt='Imagem de produto indisponível.'" loading="lazy">
                        </div>
                        <div id="product-thumbnails" class="flex gap-2 justify-center overflow-x-auto p-2">
                            ${imageList.map((img, index) => `
                                <img src="${img}" alt="Thumbnail ${index + 1} for ${product.name}" class="w-20 h-20 object-cover rounded-md cursor-pointer border-2 border-transparent hover:border-accent focus:border-accent transition-all duration-200" data-index="${index}">
                            `).join('')}
                        </div>
                        ${isOutOfStock ? '<div class="absolute top-4 left-4 bg-red-600 text-white text-lg font-bold px-4 py-2 rounded-lg z-10">ESGOTADO</div>' : ''}
                    </div>
                    <div class="flex flex-col justify-center">
                        <h2 class="text-4xl font-extrabold text-white mb-3">${product.name}</h2>
                        <div class="flex items-center mb-4">
                            ${renderStars(averageRating)}
                            <span class="ml-2 text-gray-400 text-sm">(${ratingCount} avaliações)</span>
                        </div>
                        <p class="text-gray-300 text-lg mb-6">${product.description}</p>

                        <div class="my-6 bg-secondary p-4 rounded-lg">
                            <h3 class="text-xl font-bold text-white mb-3">Especificações</h3>
                            <ul class="space-y-2 text-gray-300 text-sm">
                                ${product.brand ? `<li class="flex justify-between py-1 border-b border-gray-700"><span>Marca</span> <span class="font-semibold text-white">${product.brand}</span></li>` : ''}
                                ${product.color ? `<li class="flex justify-between py-1 border-b border-gray-700"><span>Cor</span> <span class="font-semibold text-white">${product.color}</span></li>` : ''}
                                ${product.material ? `<li class="flex justify-between py-1 border-b border-gray-700"><span>Material</span> <span class="font-semibold text-white">${product.material}</span></li>` : ''}
                                <li class="flex justify-between py-1"><span>Disponibilidade</span> <span class="font-semibold ${product.stock > 0 ? 'text-green-400' : 'text-red-400'}">${product.stock > 0 ? `Em Stock (${product.stock} unidades)` : 'Esgotado'}</span></li>
                            </ul>
                        </div>

                        <span class="text-4xl font-bold text-accent mb-6">€${product.price.toFixed(2)}</span>
                        ${addToCartButtonDetail}
                        <div class="mt-8 pt-6 border-t border-gray-700">
                            <h3 class="text-2xl font-bold mb-4">Deixe a sua Avaliação</h3>
                            ${reviewSectionHtml}
                        </div>
                        <div class="mt-8 pt-6 border-t border-gray-700">
                            <h3 class="text-2xl font-bold mb-4">Comentários dos Clientes</h3>
                            <div id="product-reviews-list"></div>
                        </div>
                    </div>
                </div>`;
            this.initProductGallery();
            this.initProductGallery();
            this.loadProductReviews(productId);
            this.updateWishlistIcons(product.id, this.isProductInWishlist(product.id));
            this.renderBundleSection(product, container);
            container.insertAdjacentHTML('beforeend', this.renderRelatedProducts(product));
        } else {
            container.innerHTML = `<h2 class="text-center text-2xl py-20">Produto não encontrado.</h2>`;
        }
    },

    initProductGallery() {
        const gallery = document.getElementById('product-gallery');
        if (!gallery) return;

        const mainImage = gallery.querySelector('#main-product-image');
        const thumbnails = gallery.querySelectorAll('#product-thumbnails img');

        if (!mainImage || thumbnails.length <= 1) {
            const thumbContainer = document.getElementById('product-thumbnails');
            if (thumbContainer) thumbContainer.style.display = 'none';
            return;
        }

        thumbnails[0].classList.add('border-accent');
        thumbnails[0].classList.remove('border-transparent');

        thumbnails.forEach(thumb => {
            thumb.addEventListener('click', () => {
                mainImage.src = thumb.src;
                thumbnails.forEach(t => t.classList.replace('border-accent', 'border-transparent'));
                thumb.classList.replace('border-transparent', 'border-accent');
            });
        });
    },

    renderBundleSection(product, container) {
        if (!product.bundle || !product.bundle.items || product.bundle.items.length === 0) {
            return;
        }

        const bundleItems = [product, ...product.bundle.items.map(id => this.products.find(p => p.id === id)).filter(Boolean)];

        if (bundleItems.length < 2) return; // Not a valid bundle if a bundled product wasn't found

        const originalPrice = bundleItems.reduce((sum, item) => sum + item.price, 0);
        const discount = product.bundle.discount || 0;
        const discountedPrice = originalPrice * (1 - discount / 100);

        const bundleHtml = `
            <div class="mt-12 pt-8 border-t-2 border-gray-700">
                <h3 class="text-3xl font-bold text-center mb-8">Complete a sua experiência</h3>
                <div class="flex flex-col md:flex-row items-center justify-center gap-4 text-center">
                    ${bundleItems.map(item => {
                        const imageUrl = (item.images && item.images[0]) || item.image;
                        return `
                        <div class="w-32 text-center">
                            <a href="#/product-detail?id=${item.id}" class="block p-2 rounded-lg hover:bg-secondary transition-colors">
                                <img src="${imageUrl}" alt="${item.name}" class="w-24 h-24 object-cover rounded-lg mx-auto mb-2 border-2 border-gray-700">
                                <p class="text-sm font-semibold truncate h-10">${item.name}</p>
                                <p class="text-xs text-gray-400">€${item.price.toFixed(2)}</p>
                            </a>
                        </div>
                    `}).join('<div class="text-4xl text-accent mx-2 self-center">+</div>')}
                </div>
                <div class="text-center mt-8 bg-secondary p-6 rounded-lg max-w-lg mx-auto">
                     <p class="text-lg text-green-400 font-semibold">Compre o conjunto e poupe ${discount}%!</p>
                     <div class="flex items-center justify-center gap-4 my-2">
                        <span class="text-2xl text-gray-500 line-through">€${originalPrice.toFixed(2)}</span>
                        <span class="text-4xl font-bold text-accent">€${discountedPrice.toFixed(2)}</span>
                     </div>
                     <button class="btn btn-primary mt-4 add-bundle-to-cart-btn" data-product-id="${product.id}">
                        <i class="fas fa-shopping-cart mr-2"></i> Adicionar Conjunto ao Carrinho
                     </button>
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', bundleHtml);
    },

    renderRelatedProducts(currentProduct) {
        if (!currentProduct || !currentProduct.tags || currentProduct.tags.length === 0) {
            return this.renderRelatedProductsByCategory(currentProduct);
        }

        const productsWithScores = this.products
            .map(p => {
                if (p.id === currentProduct.id || !p.tags) return { ...p, score: 0 };

                const commonTags = p.tags.filter(tag => currentProduct.tags.includes(tag));
                return { ...p, score: commonTags.length };
            })
            .filter(p => p.score > 0)
            .sort((a, b) => b.score - a.score);

        const relatedProducts = productsWithScores.slice(0, 4);

        if (relatedProducts.length === 0) {
            return this.renderRelatedProductsByCategory(currentProduct);
        }

        return `
            <div class="mt-12 pt-8 border-t-2 border-gray-700">
                <h3 class="text-3xl font-bold text-center mb-8">Também poderá gostar</h3>
                <div class="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    ${relatedProducts.map(p => renderProductCard(p, this.isProductInWishlist.bind(this))).join('')}
                </div>
            </div>
        `;
    },

    renderRelatedProductsByCategory(currentProduct) {
        if (!currentProduct || !currentProduct.category) return '';

        const relatedProducts = this.products
            .filter(p => p.category === currentProduct.category && p.id !== currentProduct.id)
            .sort(() => 0.5 - Math.random())
            .slice(0, 4);

        if (relatedProducts.length === 0) return '';

        return `
            <div class="mt-12 pt-8 border-t-2 border-gray-700">
                <h3 class="text-3xl font-bold text-center mb-8">Também poderá gostar</h3>
                <div class="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    ${relatedProducts.map(p => renderProductCard(p, this.isProductInWishlist.bind(this))).join('')}
                </div>
            </div>
        `;
    },
    async checkIfUserCanReview(productId) {
        if (!this.user) return false;
        const reviewQuery = query(collection(this.db, "product_ratings"), where("userId", "==", this.user.uid), where("productId", "==", productId));
        const reviewSnapshot = await getDocs(reviewQuery);
        if (!reviewSnapshot.empty) return false;
        const ordersSnapshot = await getDocs(query(collection(this.db, "orders"), where("userId", "==", this.user.uid)));
        for (const orderDoc of ordersSnapshot.docs) {
            const order = orderDoc.data();
            if (order && Array.isArray(order.items) && order.items.some(item => item.id === productId)) return true;
        }
        return false;
    },

    async submitProductRating(productId) {
        if (!this.user) {
            this.showToast('Você precisa estar logado para enviar uma avaliação.', 'error');
            this.openAuthModal('login');
            return;
        }

        const canReview = await this.checkIfUserCanReview(productId);
        if (!canReview) {
            this.showToast('Só pode avaliar produtos que já comprou e apenas uma vez.', 'error');
            return;
        }

        const score = parseInt(document.getElementById('review-score').value);
        const comment = document.getElementById('review-comment').value.trim();
        const imageFile = document.getElementById('review-image')?.files[0];

        if (isNaN(score) || score < 1 || score > 5) {
            this.showToast('Por favor, selecione uma pontuação válida entre 1 e 5.', 'error');
            return;
        }

        this.showLoading();
        let imageUrl = null;

        try {
            // 1. Upload image if it exists
            if (imageFile) {
                if (imageFile.size > 2 * 1024 * 1024) { // 2MB limit
                   this.showToast('A imagem é demasiado grande. O limite é 2MB.', 'error');
                   this.hideLoading();
                   return;
                }
                const fileName = `${this.user.uid}_${Date.now()}_${imageFile.name}`;
                const storageRef = ref(this.storage, `reviews/${fileName}`);
                const snapshot = await uploadBytes(storageRef, imageFile);
                imageUrl = await getDownloadURL(snapshot.ref);
            }

            // 2. Save review document with 'pending' status
            const newRatingRef = doc(collection(this.db, "product_ratings"));
            await setDoc(newRatingRef, {
                productId: productId,
                userId: this.user.uid,
                userName: this.userProfile?.firstName || this.user.email,
                score: score,
                comment: comment,
                imageUrl: imageUrl,
                createdAt: serverTimestamp(),
                status: 'pending'
            });

            // 3. Inform user and refresh the view
            this.showToast('Avaliação submetida! Ficará visível após aprovação.');
            this.renderProductDetail(productId);

        } catch (error) {
            console.error("Erro ao enviar avaliação:", error);
            this.showToast('Erro ao enviar sua avaliação. Tente novamente.', 'error');
        } finally {
            this.hideLoading();
        }
    },

    async loadProductReviews(productId) {
        const reviewsContainer = document.getElementById('product-reviews-list');
        if (!reviewsContainer) return;
        reviewsContainer.innerHTML = '<p class="text-gray-400 text-center">A carregar avaliações...</p>';

        try {
            // Query 1: Get all approved reviews for the product.
            const approvedQuery = query(collection(this.db, "product_ratings"), where("productId", "==", productId), where("status", "==", "approved"), orderBy("createdAt", "desc"));
            const approvedSnapshot = await getDocs(approvedQuery);
            let combinedReviews = approvedSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Query 2: If a user is logged in, get their own reviews for this product (including pending/rejected).
            if (this.user) {
                const userReviewsQuery = query(collection(this.db, "product_ratings"), where("productId", "==", productId), where("userId", "==", this.user.uid));
                const userReviewsSnapshot = await getDocs(userReviewsQuery);
                userReviewsSnapshot.forEach(doc => {
                    const userReview = { id: doc.id, ...doc.data() };
                    // Add the user's review only if it's not already in the list (it won't be if it's not 'approved').
                    if (!combinedReviews.some(r => r.id === userReview.id)) {
                        combinedReviews.push(userReview);
                    }
                });
            }

            // Sort the final combined list by date.
            combinedReviews.sort((a, b) => (b.createdAt?.toDate() || 0) - (a.createdAt?.toDate() || 0));

            if (combinedReviews.length === 0) {
                reviewsContainer.innerHTML = '<p class="text-gray-400 text-center">Ainda não há avaliações para este produto.</p>';
                return;
            }

            reviewsContainer.innerHTML = combinedReviews.map(review => {
                const pendingIndicator = review.status === 'pending'
                    ? '<span class="text-xs bg-yellow-500 text-black font-bold py-1 px-2 rounded-full ml-2">Pendente</span>'
                    : '';
                const reviewImage = review.imageUrl
                    ? `<div class="mt-4"><img src="${review.imageUrl}" alt="Imagem da avaliação" class="max-w-full h-auto rounded-lg cursor-pointer" style="max-height: 200px;" loading="lazy" onclick="app.showImageInModal('${review.imageUrl}')"></div>`
                    : '';

                return `
                <div class="bg-secondary p-4 rounded-lg mb-4 last:mb-0">
                    <div class="flex items-center mb-2">
                        <span class="font-bold text-white mr-2">${review.userName || 'Utilizador Anónimo'}</span>
                        ${renderStars(review.score)}
                        ${pendingIndicator}
                        <span class="ml-auto text-gray-500 text-sm">${review.createdAt ? new Date(review.createdAt.toDate()).toLocaleDateString('pt-PT') : ''}</span>
                    </div>
                    ${review.comment ? `<p class="text-gray-300">${review.comment}</p>` : ''}
                    ${reviewImage}
                </div>
                `;
            }).join('');
        } catch (error) {
            console.error("Erro ao carregar avaliações:", error);
            reviewsContainer.innerHTML = '<p class="text-gray-400 text-center">Não foi possível carregar as avaliações.</p>';
        }
    },

    async initAdminProductsPage() {
    const contentArea = document.getElementById('admin-content-area');
    if (!contentArea) return;

    const templateNode = await this.getTemplate('admin-products');
    if (!templateNode) {
        contentArea.innerHTML = '<p class="text-red-500">Erro ao carregar o conteúdo.</p>';
        return;
    }

    contentArea.innerHTML = templateNode.innerHTML;

    this.renderAdminProductList();
    this.clearAdminForm(); // inicia arrays de imagens

    const form = document.getElementById('admin-product-form');
    form.addEventListener('submit', (e) => this.handleAdminFormSubmit(e));
    document.getElementById('clear-form-btn').addEventListener('click', () => this.clearAdminForm());

    // --------------------------------------------
    //  DROPZONE PATCH SEGURO
    // --------------------------------------------

    let dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('product-image-file');

    // cria dropzone se não existir no HTML
    if (!dropZone && fileInput) {
        dropZone = document.createElement('div');
        dropZone.id = 'drop-zone';
        dropZone.className = 'border-2 border-dashed border-gray-600 rounded-md p-4 mb-3 cursor-pointer text-center';
        dropZone.innerHTML = `<p class="text-sm text-gray-400">Arraste aqui imagens ou clique para selecionar</p>`;
        fileInput.parentNode.insertBefore(dropZone, fileInput);
    }

    if (dropZone && fileInput) {
        dropZone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            if (e.target && e.target.files) this.handleAdminImageFiles(e.target.files);
        });

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.classList.add('border-accent');
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.classList.remove('border-accent');
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer?.files || null;
            if (files?.length) this.handleAdminImageFiles(files);
        });
    } else {
        console.warn("Dropzone ou input file não encontrados.");
    }

    // --------------------------------------------
    //  ALIEXPRESS SECTION — agora seguro
    // --------------------------------------------

    if (this.userProfile?.isAdmin) {

        const aliexpressSection = document.getElementById('aliexpress-integration-section');

        // não existindo, não mexe → evita erro
        if (aliexpressSection) {

            const urlParams = new URLSearchParams(window.location.search);
            let statusMessage = '';

            if (urlParams.has('aliexpress')) {
                statusMessage =
                    urlParams.get('aliexpress') === 'success'
                        ? '<p class="text-green-400">Conta AliExpress conectada com sucesso!</p>'
                        : '<p class="text-red-500">Erro ao conectar conta AliExpress.</p>';
            }

            aliexpressSection.innerHTML = `
                <div class="bg-secondary p-6 rounded-lg border border-gray-700 shadow-lg">
                    <div class="flex items-center justify-between mb-6">
                        <h3 class="text-xl font-bold flex items-center gap-3">
                            <i class="fab fa-alipay text-accent text-2xl"></i> Integração AliExpress
                        </h3>
                        <span class="text-xs bg-gray-700 text-gray-300 px-3 py-1 rounded-full border border-gray-600">API Global (SG)</span>
                    </div>

                    ${statusMessage}

                    <p class="text-gray-400 text-sm mb-6 leading-relaxed">
                        Conecte a sua conta de vendedor AliExpress para sincronizar e importar produtos automaticamente.
                        Certifique-se de que tem uma conta de vendedor ativa.
                    </p>

                    <button class="btn btn-primary w-full mb-8 flex items-center justify-center gap-3 py-3 text-lg" id="connect-aliexpress-btn">
                        <i class="fas fa-link"></i> Conectar / Atualizar Token
                    </button>

                    <div class="border-t border-gray-600 pt-6">
                        <label class="block text-gray-300 mb-3 text-sm font-bold uppercase tracking-wider" for="productIdInput">
                            Importação Rápida
                        </label>
                        <div class="flex flex-col sm:flex-row gap-3">
                            <input type="text" id="productIdInput" placeholder="Cole o URL do produto AliExpress aqui..." class="w-full p-3 rounded-md form-input text-sm border border-gray-600 focus:border-accent focus:ring-1 focus:ring-accent">
                            <button class="btn btn-secondary whitespace-nowrap flex items-center justify-center gap-2" id="importProductBtn">
                                <i class="fas fa-cloud-download-alt"></i> Importar
                            </button>
                        </div>
                        <p class="text-xs text-gray-500 mt-3 flex items-center gap-1">
                            <i class="fas fa-info-circle"></i> Ex: https://pt.aliexpress.com/item/100500xxxx.html
                        </p>
                    </div>
                    <div id="productResult" class="mt-4 text-sm font-semibold"></div>
                </div>
            `;

            document.getElementById('connect-aliexpress-btn')?.addEventListener('click', async () => {
                if (!this.user) {
                    this.showToast('Faça login para conectar AliExpress.', 'error');
                    return;
                }
                this.showLoading();
                try {
                    window.location.href = 
                        `https://europe-west3-desire-loja-final.cloudfunctions.net/aliexpressAuthRedirect?uid=${this.user.uid}`;
                } catch (error) {
                    console.error(error);
                    this.showToast('Erro ao iniciar a conexão com o AliExpress.', 'error');
                } finally {
                    this.hideLoading();
                }
            });

            document.getElementById('importProductBtn')?.addEventListener('click', async () => {
                const productUrl = document.getElementById("productIdInput").value.trim();
                if (!productUrl) return this.showToast("Informe o URL do produto AliExpress.", 'error');

                const resultDiv = document.getElementById("productResult");
                resultDiv.innerHTML = "Carregando...";

                this.showLoading();
                try {
                    const result = await importAliExpressProduct({ productUrl });
                    const product = result.data;

                    if (product.error) throw new Error(product.error);

                    // preencher formulário
                    form.name.value = product.name || '';
                    form.description.value = product.description || '';
                    form.price.value = product.price || 0;

                    this.adminImageFiles = [];
                    this.adminExistingImages = product.images || [];
                    this.renderAdminImageGallery();

                    this.showToast('Produto importado com sucesso!');
                    resultDiv.innerHTML = `<p class="text-green-400">Produto <strong>${product.name}</strong> carregado.</p>`;

                } catch (error) {
                    console.error(error);
                    this.showToast(`Erro ao importar: ${error.message}`, 'error');
                    resultDiv.innerHTML = `<p class="text-red-500">${error.message}</p>`;
                } finally {
                    this.hideLoading();
                }
            });
        }
    }
},


    handleAdminImageFiles(files) {
        const MAX_FILES = 10;
        const MAX_SIZE_MB = 2;

        if (this.adminExistingImages.length + this.adminImageFiles.length + files.length > MAX_FILES) {
            this.showToast(`Não pode carregar mais do que ${MAX_FILES} imagens no total.`, 'error');
            return;
        }

        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) {
                this.showToast(`O ficheiro '${file.name}' não é uma imagem.`, 'error');
                return;
            }
            if (file.size > MAX_SIZE_MB * 1024 * 1024) {
                this.showToast(`A imagem '${file.name}' excede o limite de ${MAX_SIZE_MB}MB.`, 'error');
                return;
            }
            this.adminImageFiles.push(file);
        });

        this.renderAdminImageGallery();
    },

    renderAdminImageGallery() {
        const galleryPreview = document.getElementById('image-gallery-preview');
        if (!galleryPreview) return;

        galleryPreview.innerHTML = ''; // Clear current previews

        // Render existing images (from URLs)
        this.adminExistingImages.forEach((url, index) => {
            const isMain = index === 0;
            const imageWrapper = document.createElement('div');
            imageWrapper.className = `relative group border-2 ${isMain ? 'border-accent' : 'border-transparent'} rounded-md overflow-hidden`;
            imageWrapper.innerHTML = `
                <img src="${url}" class="w-full h-24 object-cover" alt="Pré-visualização de imagem existente">
                <div class="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" title="Eliminar imagem" class="delete-existing-image-btn text-white hover:text-red-500" data-url="${url}"><i class="fas fa-trash"></i></button>
                    ${!isMain ? `<button type="button" title="Definir como principal" class="set-main-image-btn text-white hover:text-accent" data-url="${url}"><i class="fas fa-star"></i></button>` : ''}
                </div>
                ${isMain ? '<div class="absolute top-1 right-1 bg-accent text-white text-xs px-1.5 py-0.5 rounded">Principal</div>' : ''}
            `;
            galleryPreview.appendChild(imageWrapper);
        });

        // Render new files to be uploaded (from File objects)
        this.adminImageFiles.forEach((file, index) => {
            const imageWrapper = document.createElement('div');
            imageWrapper.className = 'relative group border-2 border-dashed border-gray-500 rounded-md overflow-hidden';
            imageWrapper.innerHTML = `
                <img src="${URL.createObjectURL(file)}" class="w-full h-24 object-cover" alt="Pré-visualização de novo ficheiro">
                <div class="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" title="Remover ficheiro" class="delete-new-image-btn text-white hover:text-red-500" data-index="${index}"><i class="fas fa-times-circle"></i></button>
                </div>
            `;
            galleryPreview.appendChild(imageWrapper);
        });

        // Add event listeners
        document.querySelectorAll('.delete-existing-image-btn').forEach(btn => btn.addEventListener('click', (e) => {
            const url = e.currentTarget.dataset.url;
            this.adminExistingImages = this.adminExistingImages.filter(imgUrl => imgUrl !== url);
            // TODO: In a real-world scenario, you might want to delete the file from Storage here,
            // but that's complex as it might be used elsewhere. For now, we just unlink it from the product.
            this.renderAdminImageGallery();
        }));

        document.querySelectorAll('.delete-new-image-btn').forEach(btn => btn.addEventListener('click', (e) => {
            const index = parseInt(e.currentTarget.dataset.index);
            this.adminImageFiles.splice(index, 1);
            this.renderAdminImageGallery();
        }));

        document.querySelectorAll('.set-main-image-btn').forEach(btn => btn.addEventListener('click', (e) => {
            const url = e.currentTarget.dataset.url;
            const oldMain = this.adminExistingImages[0];
            this.adminExistingImages = this.adminExistingImages.filter(imgUrl => imgUrl !== url);
            this.adminExistingImages.unshift(url);
            this.renderAdminImageGallery();
        }));
    },

    async initAdminOrdersPage() {
        const contentArea = document.getElementById('admin-content-area');
        if (!contentArea) return;
        const templateNode = await this.getTemplate('admin-orders');
        if (!templateNode) {
            contentArea.innerHTML = '<p class="text-red-500">Erro ao carregar o conteúdo.</p>';
            return;
        }
        contentArea.innerHTML = templateNode.innerHTML;

        await this.loadAllOrders();
        this.renderAdminOrders();
    },

    async initAdminReviewsPage() {
        const contentArea = document.getElementById('admin-content-area');
        if (!contentArea) return;
        const templateNode = await this.getTemplate('admin-reviews');
        if (!templateNode) {
            contentArea.innerHTML = '<p class="text-red-500">Erro ao carregar o conteúdo.</p>';
            return;
        }
        contentArea.innerHTML = templateNode.innerHTML;

        this.showLoading();
        try {
            const q = query(collection(this.db, "product_ratings"), where("status", "==", "pending"), orderBy("createdAt", "desc"));
            const querySnapshot = await getDocs(q);
            const pendingReviews = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            this.renderPendingReviews(pendingReviews);
        } catch (error) {
            console.error("Erro ao carregar avaliações pendentes:", error);
            document.getElementById('admin-reviews-list').innerHTML = '<p class="text-red-500">Não foi possível carregar as avaliações.</p>';
        } finally {
            this.hideLoading();
        }
    },

    renderPendingReviews(reviews) {
        const container = document.getElementById('admin-reviews-list');
        if (reviews.length === 0) {
            container.innerHTML = '<p class="text-gray-400">Não há avaliações pendentes.</p>';
            return;
        }

        container.innerHTML = reviews.map(review => {
            const product = this.products.find(p => p.id === review.productId);
            const reviewImage = review.imageUrl ? `<img src="${review.imageUrl}" class="w-24 h-24 object-cover rounded-md mt-2 cursor-pointer" onclick="app.showImageInModal('${review.imageUrl}')">` : '';
            return `
                <div class="bg-secondary p-4 rounded-lg flex gap-4 items-start">
                    <div class="flex-1">
                        <p class="text-sm text-gray-400">
                            Produto: <a href="#/product-detail?id=${review.productId}" target="_blank" class="text-accent hover:underline">${product?.name || 'Produto não encontrado'}</a>
                        </p>
                        <p class="text-sm text-gray-400">Utilizador: ${review.userName}</p>
                        <div class="my-2">${renderStars(review.score)}</div>
                        <p class="text-gray-200 italic">"${review.comment}"</p>
                        ${reviewImage}
                    </div>
                    <div class="flex flex-col gap-2">
                        <button class="btn btn-primary approve-review-btn" data-id="${review.id}" data-product-id="${review.productId}" data-score="${review.score}">Aprovar</button>
                        <button class="btn btn-danger reject-review-btn" data-id="${review.id}">Rejeitar</button>
                    </div>
                </div>
            `;
        }).join('');

        document.querySelectorAll('.approve-review-btn').forEach(btn => btn.addEventListener('click', (e) => this.approveReview(e.currentTarget.dataset.id, e.currentTarget.dataset.productId, parseInt(e.currentTarget.dataset.score))));
        document.querySelectorAll('.reject-review-btn').forEach(btn => btn.addEventListener('click', (e) => this.rejectReview(e.currentTarget.dataset.id)));
    },

    async approveReview(reviewId, productId, score) {
        this.showLoading();
        try {
            const productRef = doc(this.db, "products", productId);
            const reviewRef = doc(this.db, "product_ratings", reviewId);

            await runTransaction(this.db, async (transaction) => {
                const productDoc = await transaction.get(productRef);
                if (!productDoc.exists()) throw "Produto não encontrado!";

                const productData = productDoc.data();
                const currentAverageRating = productData.averageRating || 0;
                const currentRatingCount = productData.ratingCount || 0;

                const newRatingCount = currentRatingCount + 1;
                const newAverageRating = ((currentAverageRating * currentRatingCount) + score) / newRatingCount;

                transaction.update(productRef, {
                    averageRating: newAverageRating,
                    ratingCount: newRatingCount
                });
                transaction.update(reviewRef, { status: 'approved' });
            });

            this.showToast('Avaliação aprovada e publicada!');
            await this.initAdminReviewsPage(); // Refresh the list
        } catch (error) {
            console.error("Erro ao aprovar avaliação:", error);
            this.showToast('Erro ao aprovar a avaliação.', 'error');
        } finally {
            this.hideLoading();
        }
    },

    async rejectReview(reviewId) {
        this.showLoading();
        try {
            const reviewRef = doc(this.db, "product_ratings", reviewId);
            await updateDoc(reviewRef, { status: 'rejected' });
            this.showToast('Avaliação rejeitada.');
            await this.initAdminReviewsPage(); // Refresh the list
        } catch (error) {
            console.error("Erro ao rejeitar avaliação:", error);
            this.showToast('Erro ao rejeitar a avaliação.', 'error');
        } finally {
            this.hideLoading();
        }
    },

    renderAdminProductList() {
        const listEl = document.getElementById('admin-product-list');
        if (!listEl) return;
        const sortedProducts = [...this.products].sort((a, b) => a.name.localeCompare(b.name));
        listEl.innerHTML = sortedProducts.length > 0 ? sortedProducts.map(p => {
            const imageUrl = (p.images && p.images[0]) || p.image;
            return `
            <div class="flex items-center justify-between bg-gray-800 p-3 rounded-lg">
                <div class="flex items-center gap-4 flex-1 min-w-0">
                    <img src="${imageUrl}" class="w-16 h-16 object-cover rounded-md mr-2" onerror="this.onerror=null;this.src='https://placehold.co/64x64/2d2d2d/f1f1f1?text=Img';" alt="Imagem" loading="lazy">
                    <div class="min-w-0">
                        <p class="font-bold truncate">${p.name}</p>
                        <p class="text-sm text-gray-400">€${p.price.toFixed(2)} | ${p.category}</p>
                        ${p.showUrgency ? '<p class="text-xs text-yellow-400">Urgência Ativada</p>' : ''}
                        <div class="flex items-center mt-1">
                            ${renderStars(p.averageRating || 0)}
                            <span class="ml-1 text-gray-400 text-xs">(${p.ratingCount || 0})</span>
                        </div>
                    </div>
                </div>
                <div class="flex gap-2 flex-shrink-0 ml-4">
                    <button aria-label="Editar ${p.name}" class="btn-secondary px-3 py-1 rounded-md edit-product-btn" data-id="${p.id}"><i class="fas fa-edit"></i></button>
                    <button aria-label="Gerir Bundle para ${p.name}" title="Gerir Bundle" class="btn-secondary text-green-400 px-3 py-1 rounded-md bundle-btn" data-id="${p.id}"><i class="fas fa-box-open"></i></button>
                    <button aria-label="Promoção Relâmpago para ${p.name}" class="btn-secondary text-yellow-400 px-3 py-1 rounded-md flash-sale-btn" data-id="${p.id}"><i class="fas fa-bolt"></i></button>
                    <button aria-label="Apagar ${p.name}" class="btn-danger px-3 py-1 rounded-md delete-product-btn" data-id="${p.id}"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        `}).join('') : '<p class="text-gray-400">Nenhum produto na loja.</p>';

        document.querySelectorAll('.edit-product-btn').forEach(btn => btn.addEventListener('click', (e) => this.populateAdminFormForEdit(e.currentTarget.dataset.id)));
        document.querySelectorAll('.delete-product-btn').forEach(btn => btn.addEventListener('click', (e) => this.handleDeleteProduct(e.currentTarget.dataset.id)));
        document.querySelectorAll('.bundle-btn').forEach(btn => btn.addEventListener('click', (e) => this.openBundleModal(e.currentTarget.dataset.id)));
    },

    async openBundleModal(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        const modalContainer = document.getElementById('bundle-modal-container');
        if (!modalContainer) return;

        const templateNode = await this.getTemplate('bundle-modal');
        if (!templateNode) {
            this.showToast('Erro ao carregar o modal de bundle.', 'error');
            return;
        }
        modalContainer.innerHTML = templateNode.innerHTML;

        document.getElementById('bundle-product-id').value = productId;
        document.getElementById('bundle-product-name').textContent = product.name;

        const productList = document.getElementById('bundle-product-list');
        const otherProducts = this.products.filter(p => p.id !== productId);

        const existingBundleItems = product.bundle?.items || [];
        const existingDiscount = product.bundle?.discount || 0;

        productList.innerHTML = otherProducts.map(p => {
            const imageUrl = (p.images && p.images[0]) || p.image;
            return `
            <label class="flex items-center gap-3 p-2 rounded-md hover:bg-gray-700 transition-colors">
                <input type="checkbox" value="${p.id}" class="h-4 w-4 rounded border-gray-600 bg-gray-700 text-accent focus:ring-accent" ${existingBundleItems.includes(p.id) ? 'checked' : ''}>
                <img src="${imageUrl}" class="w-8 h-8 object-cover rounded-sm">
                <span>${p.name}</span>
                <span class="ml-auto text-gray-400">€${p.price.toFixed(2)}</span>
            </label>
        `}).join('');

        document.getElementById('bundle-discount').value = existingDiscount;

        document.getElementById('close-bundle-modal-btn').addEventListener('click', () => this.closeBundleModal());
        document.getElementById('bundle-form').addEventListener('submit', (e) => this.handleBundleSubmit(e));
        document.getElementById('remove-bundle-btn').addEventListener('click', () => this.handleRemoveBundle(productId));
    },

    closeBundleModal() {
        const modalContainer = document.getElementById('bundle-modal-container');
        modalContainer.innerHTML = '';
    },

    async handleBundleSubmit(e) {
        e.preventDefault();
        const form = e.target;
        if (!this.validateForm(form)) {
            this.showToast('Por favor, preencha o campo de desconto corretamente.', 'error');
            return;
        }

        this.showLoading();
        const productId = form.querySelector('#bundle-product-id').value;
        const selectedItems = Array.from(form.querySelectorAll('#bundle-product-list input:checked')).map(input => input.value);
        const discount = parseInt(form.querySelector('#bundle-discount').value);

        const bundleData = {
            items: selectedItems,
            discount: discount
        };

        try {
            await updateDoc(doc(this.db, "products", productId), { bundle: bundleData });

            // Update local product data
            const productIndex = this.products.findIndex(p => p.id === productId);
            if (productIndex > -1) {
                this.products[productIndex].bundle = bundleData;
            }

            this.showToast('Bundle guardado com sucesso!');
            this.closeBundleModal();
        } catch (error) {
            console.error("Erro ao guardar o bundle:", error);
            this.showToast('Erro ao guardar o bundle.', 'error');
        } finally {
            this.hideLoading();
        }
    },

    async handleRemoveBundle(productId) {
         this.showConfirmationModal('Remover Bundle?', 'Esta ação irá remover a configuração de bundle para este produto.',
            async () => {
                this.showLoading();
                try {
                    // Firestore does not have a direct way to delete a field, so we set it to null or use a specific method if available.
                    // For this project, we can update the field to be an empty object or null.
                    await updateDoc(doc(this.db, "products", productId), { bundle: null });

                     const productIndex = this.products.findIndex(p => p.id === productId);
                    if (productIndex > -1) {
                        delete this.products[productIndex].bundle;
                    }

                    this.showToast('Bundle removido com sucesso.');
                    this.closeBundleModal();
                } catch (error) {
                     console.error("Erro ao remover o bundle:", error);
                    this.showToast('Erro ao remover o bundle.', 'error');
                } finally {
                    this.hideLoading();
                }
            }
        );
    },

    async handleAdminFormSubmit(e) {
        e.preventDefault();
        const form = e.target;

        // Validação básica usando o método existente (que já verifica required)
        if (!this.validateForm(form)) {
            this.showToast('Por favor, preencha todos os campos obrigatórios.', 'error');
            return;
        }
        if (this.adminExistingImages.length === 0 && this.adminImageFiles.length === 0) {
            this.showToast('É necessário pelo menos uma imagem para o produto.', 'error');
            return;
        }

        this.showLoading();

        // Helper seguro para extrair valores do formulário
        const getValue = (name) => {
            const el = form.elements[name];
            return el ? el.value.trim() : '';
        };
        const getNumber = (name) => {
            const el = form.elements[name];
            return el ? parseFloat(el.value) : 0;
        };
        const getInt = (name) => {
            const el = form.elements[name];
            return el ? parseInt(el.value) : 0;
        };
        const getChecked = (name) => {
            const el = form.elements[name];
            return el ? el.checked : false;
        };

        const productId = form.id.value;

        let finalImageUrls = [...this.adminExistingImages];

        // Upload new files
        for (const file of this.adminImageFiles) {
            try {
                const storageRef = ref(this.storage, `products/${Date.now()}_${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                const downloadURL = await getDownloadURL(snapshot.ref);
                finalImageUrls.push(downloadURL);
            } catch (uploadError) {
                console.error("Erro no upload da imagem:", uploadError);
                this.showToast(`Erro ao fazer upload de '${file.name}'.`, 'error');
                this.hideLoading();
                return;
            }
        }

        // Extração de tags com segurança
        const tagsValue = getValue('tags');
        const tagsArray = tagsValue ? tagsValue.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

        const productData = {
            name: getValue('name'),
            description: getValue('description'),
            price: getNumber('price'),
            category: getValue('category').toLowerCase(),
            stock: getInt('stock'),
            brand: getValue('brand'),
            color: getValue('color'),
            material: getValue('material'),
            tags: tagsArray,
            showUrgency: getChecked('showUrgency'),
            images: finalImageUrls,
            // Preserve rating when updating
            averageRating: productId ? (this.products.find(p => p.id === productId)?.averageRating || 0) : 0,
            ratingCount: productId ? (this.products.find(p => p.id === productId)?.ratingCount || 0) : 0,
            aliexpressUrl: getValue('aliexpressUrl')
        };

        try {
            if (productId) {
                await updateDoc(doc(this.db, "products", productId), productData);
                const productIndex = this.products.findIndex(p => p.id === productId);
                if (productIndex > -1) this.products[productIndex] = { ...this.products[productIndex], ...productData };
                this.showToast('Produto atualizado com sucesso!');
            } else {
                const docRef = await addDoc(collection(this.db, "products"), productData);
                this.products.push({ id: docRef.id, ...productData });
                this.showToast('Produto adicionado com sucesso!');
            }
            localStorage.removeItem('products_cache');
            this.clearAdminForm();
            this.renderAdminProductList();
            this.applyFilters();
        } catch (error) {
            console.error("Erro ao guardar produto:", error);
            this.showToast('Erro ao guardar o produto. Verifique as regras da base de dados.', 'error');
        } finally {
            this.hideLoading();
        }
    },

    populateAdminFormForEdit(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        this.clearAdminForm(); // Reset state before populating

        const form = document.getElementById('admin-product-form');
        form.id.value = productId;
        form.name.value = product.name || '';
        form.description.value = product.description || '';
        form.price.value = product.price || 0;
        form.category.value = product.category || '';
        form.stock.value = product.stock || 0;
        form.brand.value = product.brand || '';
        form.color.value = product.color || '';
        form.material.value = product.material || '';
        form.showUrgency.checked = !!product.showUrgency;
        form.tags.value = (product.tags || []).join(', ');
        form.aliexpressUrl.value = product.aliexpressUrl || '';

        // Populate and render the image gallery
        this.adminExistingImages = product.images || (product.image ? [product.image] : []);
        this.renderAdminImageGallery();

        document.getElementById('admin-form-title').textContent = 'Editar Produto';
        form.scrollIntoView({ behavior: 'smooth' });
    },

    clearAdminForm() {
        const form = document.getElementById('admin-product-form');
        if (form) {
            form.reset();
            form.id.value = '';
        }

        // Reset image management state
        this.adminImageFiles = [];
        this.adminExistingImages = [];

        // Update the UI
        this.renderAdminImageGallery();

        const adminFormTitle = document.getElementById('admin-form-title');
        if (adminFormTitle) {
            adminFormTitle.textContent = 'Adicionar Novo Produto';
        }
    },

    handleDeleteProduct(productId) {
        this.showConfirmationModal('Apagar Produto?', 'Esta ação é irreversível e irá remover o produto da loja.',
            async () => {
                this.showLoading();
                try {
                    await deleteDoc(doc(this.db, "products", productId));
                    this.showToast('Produto apagado com sucesso.');
                    this.products = this.products.filter(p => p.id !== productId);
                    localStorage.removeItem('products_cache');
                    this.renderAdminProductList();
                    this.applyFilters();
                } catch (error) { this.showToast('Erro ao apagar o produto.', 'error');
                } finally { this.hideLoading(); }
            }
        );
    },

    openFlashSaleModal(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        const modal = document.getElementById('flash-sale-modal');
        document.getElementById('flash-sale-heading').textContent = `Promoção para: ${product.name}`;
        document.getElementById('flash-sale-product-id').value = productId;
        modal.classList.replace('hidden', 'flex');

        const form = document.getElementById('flash-sale-form');
        const submitHandler = (e) => this.handleFlashSaleSubmit(e);
        const removeHandler = () => this.removeFlashSale();

        form.addEventListener('submit', submitHandler, { once: true });
        document.getElementById('cancel-flash-sale-btn').addEventListener('click', () => this.closeFlashSaleModal(submitHandler, removeHandler), { once: true });
        document.getElementById('remove-flash-sale-btn').addEventListener('click', removeHandler, { once: true });
    },

    closeFlashSaleModal(submitHandler, removeHandler) {
        document.getElementById('flash-sale-modal').classList.replace('flex', 'hidden');
        const form = document.getElementById('flash-sale-form');
        form.reset();
        if (submitHandler) form.removeEventListener('submit', submitHandler);
        if (removeHandler) document.getElementById('remove-flash-sale-btn').removeEventListener('click', removeHandler);
    },

    openNotifyMeModal(productId) {
        const modal = document.getElementById('notify-me-modal');
        const content = document.getElementById('notify-me-content');
        if (!modal || !content) return;

        const product = this.products.find(p => p.id === productId);
        if (!product) {
            this.showToast('Produto não encontrado.', 'error');
            return;
        }

        if (this.user) {
            content.innerHTML = `
                <p class="text-gray-400 mb-4">Iremos notificar o email <strong class="text-white">${this.user.email}</strong>.</p>
                <button class="btn btn-primary w-full" id="confirm-notification-btn">Confirmar Pedido</button>
            `;
            document.getElementById('confirm-notification-btn').addEventListener('click', () => this.handleNotifyMeSubmit(productId), { once: true });
        } else {
            content.innerHTML = `
                <form id="notify-me-form" novalidate>
                    <div class="mb-4">
                        <label for="notify-email" class="sr-only">O seu Email</label>
                        <input type="email" id="notify-email" placeholder="Insira o seu email" required class="w-full p-3 rounded-md form-input">
                    </div>
                    <button type="submit" class="btn btn-primary w-full">Pedir Notificação</button>
                </form>
            `;
            document.getElementById('notify-me-form').addEventListener('submit', (e) => {
                e.preventDefault();
                if (this.validateForm(e.target)) {
                    this.handleNotifyMeSubmit(productId);
                }
            });
        }

        modal.classList.replace('hidden', 'flex');
        document.getElementById('close-notify-me-modal').addEventListener('click', () => this.closeNotifyMeModal(), { once: true });
    },

    closeNotifyMeModal() {
        const modal = document.getElementById('notify-me-modal');
        if (modal) modal.classList.replace('flex', 'hidden');
    },

    async handleNotifyMeSubmit(productId) {
        const emailInput = document.getElementById('notify-email');
        const email = this.user ? this.user.email : emailInput?.value;

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            this.showToast('Por favor, insira um email válido.', 'error');
            if(emailInput) emailInput.classList.add('invalid');
            return;
        }

        this.showLoading();
        try {
            const notificationRef = collection(this.db, "notifications");
            await addDoc(notificationRef, {
                email: email,
                productId: productId,
                userId: this.user ? this.user.uid : null,
                createdAt: serverTimestamp(),
                status: 'pending' // Status pode ser 'pending' ou 'sent'
            });
            // TODO: Lançamento: Uma Firebase Function deve monitorizar esta coleção e enviar os emails de notificação.
            this.showToast('Pedido recebido! Iremos notificá-lo assim que o produto estiver disponível.');
            this.closeNotifyMeModal();
        } catch (error) {
            console.error("Erro ao guardar pedido de notificação:", error);
            this.showToast('Ocorreu um erro. Tente novamente.', 'error');
        } finally {
            this.hideLoading();
        }
    },

    async handleFlashSaleSubmit(e) {
        e.preventDefault();
        const form = e.target;
        if (!this.validateForm(form)) {
            this.showToast('Por favor, preencha os campos corretamente.', 'error');
            form.addEventListener('submit', (e) => this.handleFlashSaleSubmit(e), { once: true }); // Re-attach listener
            return;
        }

        this.showLoading();
        const productId = document.getElementById('flash-sale-product-id').value;
        const discountPercentage = parseInt(document.getElementById('flash-sale-discount').value);
        const durationHours = parseInt(document.getElementById('flash-sale-duration').value);

        const endDate = new Date();
        endDate.setHours(endDate.getHours() + durationHours);

        const saleData = {
            productId: productId,
            discountPercentage: discountPercentage,
            endDate: endDate
        };

        try {
            await setDoc(doc(this.db, "flash_sale", "current"), saleData);
            this.showToast('Promoção relâmpago configurada com sucesso!');
            this.closeFlashSaleModal();
            this.initHomePage(); // Refresh home page to show the new sale
        } catch (error) {
            console.error("Erro ao configurar promoção relâmpago:", error);
            this.showToast('Erro ao configurar a promoção.', 'error');
        } finally {
            this.hideLoading();
        }
    },

    async removeFlashSale() {
        this.showConfirmationModal('Remover Promoção?', 'Isto irá remover a promoção relâmpago ativa.',
            async () => {
                this.showLoading();
                try {
                    await deleteDoc(doc(this.db, "flash_sale", "current"));
                    this.showToast('Promoção removida com sucesso.');
                    this.closeFlashSaleModal();
                    this.initHomePage(); // Refresh home page
                } catch (error) {
                    this.showToast('Erro ao remover a promoção.', 'error');
                } finally {
                    this.hideLoading();
                }
            }
        );
    },

    async loadAllOrders() {
        if (!(this.userProfile?.isAdmin)) return;
        this.showLoading();
        try {
            const querySnapshot = await getDocs(collection(this.db, "orders"));
            this.allOrders = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.allOrders.sort((a, b) => {
                const dateA = a.createdAt?.toDate() || a.timestamp?.toDate() || 0;
                const dateB = b.createdAt?.toDate() || b.timestamp?.toDate() || 0;
                return dateB - dateA;
            });
        } catch (error) { console.error("Erro ao carregar todas as encomendas (admin):", error); this.showToast('Erro ao carregar as encomendas.', 'error');
        } finally { this.hideLoading(); }
    },

    getStatusColor(status) {
        const colors = { 'Em processamento': 'bg-yellow-500 text-black', 'Enviado': 'bg-blue-500 text-white', 'Entregue': 'bg-green-500 text-white', 'Cancelado': 'bg-red-500 text-white', 'Pendente': 'bg-gray-400 text-black' };
        return colors[status] || 'bg-gray-600 text-white';
    },

    renderAdminOrders() {
        const container = document.getElementById('admin-order-list');
        if (!container) return;
        if (this.allOrders.length === 0) { container.innerHTML = '<p class="text-gray-400">Nenhuma encomenda encontrada.</p>'; return; }
        container.innerHTML = this.allOrders.map(order => {
            const dateObj = order.createdAt?.toDate() || order.timestamp?.toDate();
            const orderDate = dateObj ? new Date(dateObj).toLocaleDateString('pt-PT') : 'Data Indisponível';
            const { shippingAddress: address, status = 'Pendente' } = order;
            return `
            <div class="bg-gray-800 p-4 rounded-lg shadow-md flex justify-between items-center">
                <div>
                    <h3 class="font-bold text-lg">Encomenda #${order.id.substring(0, 8).toUpperCase()}</h3>
                    <p class="text-sm text-gray-400">Cliente: ${address.firstName} ${address.lastName} (${address.email})</p>
                    <p class="text-sm text-gray-400">Data: ${orderDate} | Total: <span class="font-bold text-white">€${order.total.toFixed(2)}</span></p>
                </div>
                 <div class="flex items-center gap-4">
                     <span class="font-bold py-1 px-3 rounded-full text-sm ${this.getStatusColor(status)}">${status}</span>
                    <button class="btn btn-secondary admin-order-details-btn" data-id="${order.id}">Detalhes</button>
                </div>
            </div>`;
        }).join('');
    },

    openAdminOrderDetailModal(orderId) {
        const order = this.allOrders.find(o => o.id === orderId);
        if (!order) { this.showToast('Encomenda não encontrada.', 'error'); return; }
        const modal = document.getElementById('admin-order-detail-modal');
        const content = document.getElementById('admin-order-detail-content');
        const { shippingAddress: address, status = 'Pendente' } = order;
        const createdDateObj = order.createdAt?.toDate() || order.timestamp?.toDate();
        const updatedDateObj = order.updatedAt?.toDate();
        const createdDate = createdDateObj ? new Date(createdDateObj).toLocaleString('pt-PT') : 'N/A';
        const updatedDate = updatedDateObj ? new Date(updatedDateObj).toLocaleString('pt-PT') : createdDate;
        content.innerHTML = `
            <button id="close-admin-order-modal-btn" class="absolute top-4 right-4 text-gray-400 hover:text-white" aria-label="Fechar"><i class="fas fa-times text-2xl"></i></button>
            <h2 id="admin-order-modal-title" class="text-3xl font-bold mb-6">Detalhes da Encomenda <span class="text-accent">#${order.id.substring(0,8).toUpperCase()}</span></h2>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                    <label for="status-select" class="block text-sm font-medium text-gray-400 mb-2">Estado da Encomenda</label>
                    <select id="status-select" data-order-id="${order.id}" class="form-select w-full p-2 rounded-md ${this.getStatusColor(status)}">
                        <option value="Pendente" ${status === 'Pendente' ? 'selected' : ''}>Pendente</option>
                        <option value="Em processamento" ${status === 'Em processamento' ? 'selected' : ''}>Em processamento</option>
                        <option value="Enviado" ${status === 'Enviado' ? 'selected' : ''}>Enviado</option>
                        <option value="Entregue" ${status === 'Entregue' ? 'selected' : ''}>Entregue</option>
                        <option value="Cancelado" ${status === 'Cancelado' ? 'selected' : ''}>Cancelado</option>
                    </select>
                </div>
                <div class="text-right">
                   <p class="text-sm text-gray-400">Data da Encomenda: <span class="font-semibold text-white">${createdDate}</span></p>
                   <p class="text-sm text-gray-400">Última Atualização: <span class="font-semibold text-white" id="modal-updated-date">${updatedDate}</span></p>
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                 <div class="bg-secondary p-4 rounded-lg">
                    <h4 class="font-semibold mb-2 text-accent">Dados do Cliente</h4>
                    <p>${address.firstName} ${address.lastName}</p>
                    <p class="text-gray-400">${address.email}</p>
                </div>
                 <div class="bg-secondary p-4 rounded-lg">
                    <h4 class="font-semibold mb-2 text-accent">Endereço de Envio</h4>
                    <p>${address.address}</p>
                    <p class="text-gray-400">${address.city}, ${address.zip}</p>
                </div>
            </div>
            <div class="bg-secondary p-4 rounded-lg">
                 <h4 class="font-semibold mb-3 text-accent">Produtos Comprados</h4>
                 <ul class="space-y-2 text-sm mb-4">
                    ${order.items.map(item => `<li class="flex items-center border-b border-gray-700 pb-2"><img src="${(item.images && item.images[0]) || item.image}" alt="${item.name}" class="w-10 h-10 object-cover rounded-md mr-2" onerror="this.onerror=null;this.src='https://placehold.co/40x40/2d2d2d/f1f1f1?text=Img';" loading="lazy"><span>${item.name} <span class="text-gray-400">(x${item.quantity})</span></span><span class="font-semibold ml-auto">€${(item.price * item.quantity).toFixed(2)}</span></li>`).join('')}
                 </ul>
                 <p class="text-right font-bold text-xl">Total: <span class="text-accent">€${order.total.toFixed(2)}</span></p>
            </div>`;
        modal.classList.replace('hidden', 'flex');
        const statusSelect = document.getElementById('status-select');
        statusSelect.addEventListener('change', (e) => {
            this.updateOrderStatus(e.target.dataset.orderId, e.target.value);
            statusSelect.className = `form-select w-full p-2 rounded-md ${this.getStatusColor(e.target.value)}`;
            document.getElementById('modal-updated-date').textContent = new Date().toLocaleString('pt-PT');
        });
    },

    closeAdminOrderDetailModal() { document.getElementById('admin-order-detail-modal').classList.replace('flex', 'hidden'); },

    async updateOrderStatus(orderId, newStatus) {
        this.showLoading();
        try {
            await updateDoc(doc(this.db, "orders", orderId), { status: newStatus, updatedAt: serverTimestamp() });
            this.showToast(`Estado da encomenda atualizado.`);
            const orderIndex = this.allOrders.findIndex(o => o.id === orderId);
            if(orderIndex > -1) {
                 this.allOrders[orderIndex].status = newStatus;
                 this.allOrders[orderIndex].updatedAt = { toDate: () => new Date() };
            }
            this.renderAdminOrders();
            // TODO: Trigger Firebase Function to send order status update email to the client.
        } catch (error) { this.showToast('Erro ao atualizar o estado.', 'error');
        } finally { this.hideLoading(); }
    },

    showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if(!container) return;
        const toast = document.createElement('div');
        const borderColor = type === 'error' ? 'border-red-500' : 'border-accent';
        const icon = type === 'error' ? 'fa-times-circle text-red-500' : 'fa-check-circle text-accent';
        toast.className = `toast-notification text-white font-semibold rounded-lg shadow-lg ${borderColor}`;
        toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => { toast.classList.remove('show'); toast.addEventListener('transitionend', () => toast.remove()); }, 4000);
    },

    showLoading() { document.getElementById('loading-overlay')?.classList.replace('hidden', 'flex'); },
    hideLoading() { document.getElementById('loading-overlay')?.classList.replace('flex', 'hidden'); },

    showConfirmationModal(title, message, onConfirm) {
        const modal = document.getElementById('confirmation-modal');
        if(!modal) return;
        modal.querySelector('#confirmation-title').textContent = title;
        modal.querySelector('#confirmation-message').textContent = message;
        const confirmBtn = modal.querySelector('#confirm-action-btn');
        const cancelBtn = modal.querySelector('#cancel-action-btn');
        const close = () => modal.classList.replace('flex', 'hidden');
        const confirmHandler = () => { onConfirm(); close(); };
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        newConfirmBtn.textContent = "Confirmar";
        newConfirmBtn.addEventListener('click', confirmHandler, { once: true });
        cancelBtn.addEventListener('click', close, { once: true });
        modal.classList.replace('hidden', 'flex');
    },

    async getRecaptchaToken(action) {
        return new Promise((resolve, reject) => {
            if (typeof grecaptcha === 'undefined') { this.showToast('reCAPTCHA não carregado.', 'error'); return reject(new Error('reCAPTCHA not loaded')); }
            grecaptcha.ready(() => {
                grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: action }).then(token => { resolve(token);
                }).catch(err => { this.showToast('Falha na verificação reCAPTCHA.', 'error'); reject(err); });
            });
        });
    },

    trackEvent(eventName, eventParams) {
        if (typeof gtag === 'function' && localStorage.getItem('cookie_consent') === 'true') {
            gtag('event', eventName, eventParams);
        }
    },

    async initContactForm() {
        const form = document.getElementById('contact-form');
        if (!form) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!this.validateForm(form)) return;
            const submitBtn = form.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.innerHTML;
            submitBtn.disabled = true; submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> A enviar...`;
            try {
                await this.getRecaptchaToken('contact');
                const name = form.querySelector('#name').value, email = form.querySelector('#email').value, message = form.querySelector('#message').value;
                await addDoc(collection(this.db, "contact_messages"), { name: name, email: email, message: message, createdAt: serverTimestamp() });
                // TODO: Trigger a Firebase Function here to send an email notification to the admin.
                this.trackEvent('generate_lead', { form_name: 'contact' });
                this.showToast('Mensagem enviada com sucesso!');
                form.reset();
            } catch (error) { console.error("Contact form submission error:", error); this.showToast('Ocorreu um erro ao enviar a sua mensagem. Por favor, tente novamente.', 'error');
            } finally { submitBtn.disabled = false; submitBtn.innerHTML = originalBtnText; }
        });
    },

    async initNewsletterForm() {
        const form = document.getElementById('newsletter-form');
        if (!form) return;
        const submitBtn = form.querySelector('button[type="submit"]');
        const emailInput = form.querySelector('#newsletter-email');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (this.validateForm(form)) {
                const originalBtnText = submitBtn.innerHTML;
                submitBtn.disabled = true; emailInput.disabled = true; submitBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
                try {
                   await this.getRecaptchaToken('newsletter');
                   await addDoc(collection(this.db, "newsletter_subscriptions"), { email: emailInput.value, subscribedAt: serverTimestamp() });
                   // TODO: Trigger a Firebase Function here to send a welcome email and notify the admin.
                   this.trackEvent('sign_up', { method: 'Newsletter' });
                   this.showToast('Obrigado por subscrever!');
                   form.reset();
                } catch(error) { console.error("Newsletter form submission error:", error); this.showToast('Ocorreu um erro na subscrição. Tente novamente.', 'error');
                } finally { submitBtn.disabled = false; emailInput.disabled = false; submitBtn.innerHTML = originalBtnText; }
            }
        });
    },

    validateForm(form, inputs = form.querySelectorAll('[required]')) {
        let allValid = true;
        inputs.forEach(input => {
            input.classList.remove('invalid');
            let inputValid = true;
            if (input.type === 'checkbox') inputValid = input.checked;
            else if (input.type === 'email') inputValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value);
            else if (input.minLength && input.value.length < input.minLength) inputValid = false;
            else if (input.type !== 'file' && !input.value.trim()) inputValid = false;
            if (!inputValid) { allValid = false; input.classList.add('invalid'); }
        });
        if (form.id === 'admin-product-form') {
            const fileInput = form.querySelector('#product-image-file');
            const isNewProduct = !form.querySelector('#product-id')?.value;
            if (fileInput && isNewProduct && fileInput.files.length === 0) { allValid = false; fileInput.classList.add('invalid'); }
        }
        return allValid;
    },

    updateAuthUI(isLoggedIn) {
        const container = document.getElementById('auth-container');
        const mobileContainer = document.getElementById('mobile-auth-container');
        if(!container || !mobileContainer) return;
        let authLinks = '';
        if (isLoggedIn) {
            authLinks = `<a href="#/account" class="text-gray-300 hover:text-accent transition" aria-label="A minha conta"><i class="fas fa-user text-xl"></i></a>`;
            if (this.userProfile?.isAdmin) authLinks += `<a href="#/admin" class="text-gray-300 hover:text-accent transition" aria-label="Painel de Admin"><i class="fas fa-user-shield text-xl"></i></a>`;
        } else { authLinks = `<button id="login-btn" class="text-gray-300 hover:text-accent transition" aria-label="Login ou Registo"><i class="fas fa-sign-in-alt text-xl"></i></button>`; }
        container.innerHTML = authLinks;
        let mobileAuthLinks = '';
        if (isLoggedIn) {
            mobileAuthLinks = `<a href="#/account" class="nav-link text-lg" data-route="/account">A Minha Conta</a>
                ${this.userProfile?.isAdmin ? '<a href="#/admin" class="nav-link text-lg" data-route="/admin">Admin</a>' : ''}
                <button id="mobile-logout-btn" class="nav-link text-lg w-full text-left">Sair</button>`;
        } else { mobileAuthLinks = `<button id="mobile-login-btn" class="nav-link text-lg">Login / Registar</button>`; }
        mobileContainer.innerHTML = mobileAuthLinks;
        document.getElementById('mobile-login-btn')?.addEventListener('click', () => this.openAuthModal('login'));
        document.getElementById('mobile-logout-btn')?.addEventListener('click', () => logout(this.auth));

        // Handle the bottom navigation account link
        const bottomNavAccountLink = document.querySelector('#bottom-nav a[data-route="/account"]');
        if (bottomNavAccountLink) {
            if (!isLoggedIn) {
                bottomNavAccountLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.openAuthModal('login');
                }, { once: true }); // Use once to avoid multiple listeners
            }
        }
    },

    getTranslation(key, replacements = {}) {
        let translation = this.translations[key] || key;
        for (const placeholder in replacements) {
            translation = translation.replace(`{${placeholder}}`, replacements[placeholder]);
        }
        return translation;
    },

    async exportUserData() {
        if (!this.user) {
            this.showToast('Você precisa estar logado para exportar os seus dados.', 'error');
            return;
        }

        this.showLoading();
        try {
            // 1. Get user profile data
            const userProfileData = { ...this.userProfile };
            delete userProfileData.cart; // Exclude cart from export

            // 2. Get user order history
            await this.loadOrders(); // Ensures this.orders is up-to-date
            const orderHistory = this.orders.map(order => {
                const sanitizedOrder = { ...order };
                if (sanitizedOrder.createdAt && sanitizedOrder.createdAt.toDate) {
                    sanitizedOrder.createdAt = sanitizedOrder.createdAt.toDate().toISOString();
                }
                if (sanitizedOrder.updatedAt && sanitizedOrder.updatedAt.toDate) {
                    sanitizedOrder.updatedAt = sanitizedOrder.updatedAt.toDate().toISOString();
                }
                return sanitizedOrder;
            });

            // 3. Combine data
            const exportData = {
                userProfile: userProfileData,
                orderHistory: orderHistory
            };

            // 4. Create and trigger download
            const dataStr = JSON.stringify(exportData, null, 4);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'my_personal_data.json';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this.showToast('Os seus dados foram exportados com sucesso.');

        } catch (error) {
            console.error("Erro ao exportar dados do utilizador:", error);
            this.showToast('Ocorreu um erro ao exportar os seus dados.', 'error');
        } finally {
            this.hideLoading();
        }
    },

    async loadProducts() {
        const CACHE_KEY = 'products_cache';
        const CACHE_DURATION = 3600000; // 1 hour in milliseconds

        try {
            const cachedDataJSON = localStorage.getItem(CACHE_KEY);
            if (cachedDataJSON) {
                const cachedData = JSON.parse(cachedDataJSON);
                if (cachedData && (Date.now() - cachedData.timestamp < CACHE_DURATION)) {
                    this.products = cachedData.products;
                    return; // Exit without showing loading indicator
                }
            }
        } catch (e) {
            console.error("Could not load products from cache", e);
            localStorage.removeItem(CACHE_KEY); // Clear corrupted cache
        }


        this.showLoading();
        try {
            const productSnapshot = await getDocs(collection(this.db, "products"));
            if (productSnapshot.empty) {
                await this.seedProducts();
                const newSnapshot = await getDocs(collection(this.db, "products"));
                this.products = newSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            } else {
                this.products = productSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            }

            // Save to cache
            const cacheData = {
                products: this.products,
                timestamp: Date.now()
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(cacheData));

        } catch (error) {
            console.error("Erro ao carregar produtos:", error);
            this.showToast("Erro ao carregar produtos.", "error");
        } finally {
            this.hideLoading();
        }
    },

    async seedProducts() {
        const mockProducts = [
            { name: 'Vibrador Whisper', description: 'Silencioso e potente, para prazer discreto.', price: 59.99, category: 'para-ela', images: ['https://images.unsplash.com/photo-1604028299862-c09923c60761?w=800&h=800&fit=crop', 'https://images.unsplash.com/photo-1594821494895-037a3d310468?w=800&h=800&fit=crop', 'https://images.unsplash.com/photo-1619451428351-62f443b2f565?w=800&h=800&fit=crop'], showUrgency: true, averageRating: 4.5, ratingCount: 124, stock: 15, brand: 'Lelo', color: 'Rosa', material: 'Silicone', tags: ['silencioso', 'potente', 'recaregável', 'lelo'] },
            { name: 'Anel Peniano Duo Charge', description: 'Vibração dupla para ele e para ela.', price: 34.99, category: 'para-ele', images: ['https://images.unsplash.com/photo-1620820908488-022b4a559b8a?w=800&h=800&fit=crop', 'https://images.unsplash.com/photo-1612871689353-ccc5a73a2d7c?w=800&h=800&fit=crop'], showUrgency: false, averageRating: 4.0, ratingCount: 80, stock: 10, brand: 'Hot Octopuss', color: 'Preto', material: 'Silicone', tags: ['casal', 'vibração', 'recaregável', 'anel'] },
            { name: 'Vibrador para Casal We-Vibe', description: 'Usado durante a penetração para prazer mútuo.', price: 129.99, category: 'para-casal', images: ['https://images.unsplash.com/photo-1606915198492-5d5b3a7c6a4c?w=800&h=800&fit=crop'], showUrgency: false, averageRating: 4.8, ratingCount: 200, stock: 0, brand: 'We-Vibe', color: 'Roxo', material: 'Silicone', tags: ['casal', 'app', 'we-vibe'] },
            { name: 'Óleo de Massagem Sensual', description: 'Óleo relaxante com aroma afrodisíaco.', price: 19.99, category: 'acessórios', images: ['https://images.unsplash.com/photo-1596462502802-53b7c2b0e6e8?w=800&h=800&fit=crop'], showUrgency: true, averageRating: 4.2, ratingCount: 50, stock: 25, brand: 'Shunga', color: 'N/A', material: 'Óleo', tags: ['óleo', 'massagem', 'relaxante', 'preliminares'] },
            { name: 'Bala Vibratória Intensa', description: 'Pequeno, discreto, mas muito potente.', price: 29.99, category: 'para-ela', images: ['https://images.unsplash.com/photo-1619451428351-62f443b2f565?w=800&h=800&fit=crop'], showUrgency: false, averageRating: 4.3, ratingCount: 95, stock: 30, brand: 'Satisfyer', color: 'Lilás', material: 'Silicone', tags: ['discreto', 'potente', 'vibração', 'lelo'] },
        ];
        try {
            const batch = writeBatch(this.db);
            mockProducts.forEach(product => {
                // Compatibility fix: if old 'image' field exists, move it to 'images' array
                if (product.image && !product.images) {
                    product.images = [product.image];
                    delete product.image;
                }
                batch.set(doc(collection(this.db, "products")), product)
            });
            await batch.commit();
            this.showToast('Produtos de exemplo adicionados à loja!');
        } catch (error) { this.showToast('Falha ao adicionar produtos de exemplo.', 'error');}
    },

    async loadUserProfile() {
        if (!this.user) return;
        const userRef = doc(this.db, "users", this.user.uid);
        const docSnap = await getDoc(userRef);

        if (docSnap.exists()) {
            this.userProfile = docSnap.data();

            // Self-healing for main admin
            if (this.user.email === 'darkdesire389@gmail.com' && !this.userProfile.isAdmin) {
                this.userProfile.isAdmin = true;
                await setDoc(userRef, { isAdmin: true }, { merge: true });
            }

            let profileUpdated = false;
            if (!this.userProfile.wishlist) {
                this.userProfile.wishlist = [];
                profileUpdated = true;
            }
            if (typeof this.userProfile.loyaltyPoints !== 'number') {
                this.userProfile.loyaltyPoints = 0;
                profileUpdated = true;
            }
            // If we had to add default fields, let's update the profile in Firestore
            if (profileUpdated) {
                await setDoc(userRef, {
                    wishlist: this.userProfile.wishlist,
                    loyaltyPoints: this.userProfile.loyaltyPoints
                }, { merge: true });
            }
        } else {
            // This case handles users that were created via Auth but never got a user profile document created.
            const newUserProfile = {
                email: this.user.email,
                isAdmin: false,
                cart: [],
                wishlist: [],
                loyaltyPoints: 0
            };
            await setDoc(userRef, newUserProfile);
            this.userProfile = newUserProfile;
        }
    },

    async addToWishlist(productId) {
        if (!this.user) { this.showToast('Faça login para adicionar à wishlist.', 'error'); this.openAuthModal('login'); return; }
        if (this.isProductInWishlist(productId)) return;

        this.userProfile.wishlist.push(productId);
        this.updateWishlistIcons(productId, true); // Optimistic UI update

        try {
            await updateDoc(doc(this.db, "users", this.user.uid), { wishlist: this.userProfile.wishlist });
            this.showToast('Adicionado à Lista de Desejos!');
        } catch (error) {
            console.error('Error adding to wishlist:', error);
            this.showToast('Erro ao adicionar à wishlist.', 'error');
            this.userProfile.wishlist = this.userProfile.wishlist.filter(id => id !== productId); // Revert
            this.updateWishlistIcons(productId, false);
        }
    },

    async removeFromWishlist(productId) {
        if (!this.user) return;
        const initialWishlist = [...this.userProfile.wishlist];
        this.userProfile.wishlist = this.userProfile.wishlist.filter(id => id !== productId);
        this.updateWishlistIcons(productId, false); // Optimistic UI update

        try {
            await updateDoc(doc(this.db, "users", this.user.uid), { wishlist: this.userProfile.wishlist });
            this.showToast('Removido da Lista de Desejos!');
        } catch (error) {
            console.error('Error removing from wishlist:', error);
            this.showToast('Erro ao remover da wishlist.', 'error');
            this.userProfile.wishlist = initialWishlist; // Revert
            this.updateWishlistIcons(productId, true);
        }

                if (window.location.hash.includes('/account?tab=wishlist')) {
                    this.renderWishlistPage();
                }
    },

    toggleWishlist(productId) {
        if (!this.user) {
            this.showToast('Faça login para usar a wishlist.', 'error');
            this.openAuthModal('login');
            return;
        }
        if (this.isProductInWishlist(productId)) {
            this.removeFromWishlist(productId);
        } else {
            this.addToWishlist(productId);
        }
    },

    isProductInWishlist(productId) {
        return this.userProfile?.wishlist?.includes(productId) || false;
    },

    updateWishlistIcons(productId, isActive) {
        document.querySelectorAll(`.wishlist-btn[data-id="${productId}"]`).forEach(btn => {
            btn.classList.toggle('active', isActive);
            const icon = btn.querySelector('i');
            if (icon) {
                icon.className = `fa-heart ${isActive ? 'fa-solid' : 'fa-regular'}`;
            }
        });
    },

    openSearch() {
        const searchOverlay = document.getElementById('search-overlay');
        if (searchOverlay) {
            searchOverlay.classList.remove('hidden');
            document.getElementById('search-input')?.focus();
        }
    },

    closeSearch() {
        const searchOverlay = document.getElementById('search-overlay');
        if (searchOverlay) {
            searchOverlay.classList.add('hidden');
        }
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            searchInput.value = '';
        }
        const suggestionsContainer = document.getElementById('search-suggestions');
        if (suggestionsContainer) {
            suggestionsContainer.innerHTML = '';
            suggestionsContainer.classList.add('hidden');
        }
    },

    initSearch() {
        const searchInput = document.getElementById('search-input');
        if (!searchInput) return;

        const handleSearchInput = this.debounce(() => {
            const searchTerm = searchInput.value.trim().toLowerCase();

            if (searchTerm.length < 2) {
                const suggestionsContainer = document.getElementById('search-suggestions');
                if (suggestionsContainer) {
                    suggestionsContainer.innerHTML = '';
                    suggestionsContainer.classList.add('hidden');
                }
                return;
            }

            const filteredProducts = this.products.filter(p =>
                p.name.toLowerCase().includes(searchTerm) ||
                p.description.toLowerCase().includes(searchTerm)
            );
            this.renderSearchSuggestions(filteredProducts, searchTerm);

            this.trackEvent('search', { search_term: searchTerm });
        }, 250);

        searchInput.addEventListener('input', handleSearchInput);

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && searchInput.value.trim()) {
                e.preventDefault();
                this.navigateTo(`/search?q=${encodeURIComponent(searchInput.value.trim())}`);
                this.closeSearch();
            }
        });
    },

    renderSearchSuggestions(products, searchTerm) {
        const suggestionsContainer = document.getElementById('search-suggestions');
        if (!suggestionsContainer) return;

        if (products.length === 0) {
            const categories = [...new Set(this.products.map(p => p.category).filter(Boolean))];
            let suggestionsHtml = '<p class="p-4 text-center text-gray-400">Nenhum produto encontrado.</p>';

            if (categories.length > 0) {
                suggestionsHtml += `
                    <div class="p-4 border-t border-gray-700">
                        <h4 class="font-semibold text-white mb-3 text-center">Experimente pesquisar por categoria:</h4>
                        <div class="flex flex-wrap justify-center gap-2">
                            ${categories.map(cat => `
                                <a href="#/products?category=${encodeURIComponent(cat)}" class="search-suggestion-item bg-secondary hover:bg-accent text-white text-sm font-semibold px-3 py-1 rounded-full transition-colors">
                                    ${cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ')}
                                </a>
                            `).join('')}
                        </div>
                    </div>
                `;
            }

            suggestionsContainer.innerHTML = suggestionsHtml;
            suggestionsContainer.classList.remove('hidden');
            return;
        }

        const itemsHtml = products.slice(0, 5).map(p => {
            const imageUrl = (p.images && p.images[0]) || p.image;
            return `
                <a href="#/product-detail?id=${p.id}" class="search-suggestion-item flex items-center p-3 hover:bg-secondary transition-colors">
                    <img src="${imageUrl}" alt="${p.name}" class="w-12 h-12 object-cover rounded-md mr-4" onerror="this.onerror=null;this.src='https://placehold.co/48x48/1a1a1a/e11d48?text=Img';">
                    <div>
                        <p class="font-semibold text-white">${p.name}</p>
                        <p class="text-sm text-accent">€${p.price.toFixed(2)}</p>
                    </div>
                </a>
            `;
        }).join('');

        const seeAllHtml = `<a href="#/search?q=${encodeURIComponent(searchTerm)}" class="block text-center p-3 font-semibold text-accent hover:bg-secondary transition-colors">Ver todos os ${products.length} resultados</a>`;

        suggestionsContainer.innerHTML = itemsHtml + seeAllHtml;
        suggestionsContainer.classList.remove('hidden');
    },

    initMobileMenu() {
        const menuButton = document.getElementById('mobile-menu-button');
        const mobileMenu = document.getElementById('mobile-menu');
        const closeButton = document.getElementById('close-mobile-menu-button');
        const toggleMenu = () => {
            const isExpanded = menuButton.getAttribute('aria-expanded') === 'true';
            menuButton.setAttribute('aria-expanded', !isExpanded);
            mobileMenu.classList.toggle('translate-x-full');
        };
        menuButton.addEventListener('click', toggleMenu);
        closeButton.addEventListener('click', toggleMenu);
        mobileMenu.addEventListener('click', (e) => { if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') toggleMenu(); });
    },

    async openAuthModal(formType = 'login') {
        const modal = document.getElementById('auth-modal');
        const content = document.getElementById('auth-content');
        if(!modal || !content) return;

        const renderForm = async (type) => {
            const templateId = type === 'login' ? 'login-form' : 'register-form';
            const templateNode = await this.getTemplate(templateId);

            if (templateNode) {
                content.innerHTML = templateNode.innerHTML;
                if (type === 'login') {
                    document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
                    document.getElementById('show-register-form').addEventListener('click', () => renderForm('register'));
                    document.getElementById('forgot-password-btn').addEventListener('click', () => this.handleForgotPassword());
                } else {
                    document.getElementById('register-form').addEventListener('submit', (e) => this.handleRegister(e));
                    document.getElementById('show-login-form').addEventListener('click', () => renderForm('login'));
                }
            } else {
                content.innerHTML = '<p class="text-red-500">Erro ao carregar o formulário. Tente novamente mais tarde.</p>';
            }
        };

        await renderForm(formType);
        modal.classList.replace('hidden', 'flex');
        document.getElementById('close-auth-modal').addEventListener('click', () => this.closeAuthModal(), {once: true});
    },

    closeAuthModal() { document.getElementById('auth-modal').classList.replace('flex', 'hidden'); },

    showWelcomePopup() {
        const popup = document.getElementById('first-visit-popup');
        if (popup) {
            popup.classList.replace('hidden', 'flex');
            document.getElementById('close-welcome-popup-btn').addEventListener('click', () => this.closeWelcomePopup(), { once: true });
        }
    },

    closeWelcomePopup() {
        const popup = document.getElementById('first-visit-popup');
        if (popup) {
            popup.classList.replace('flex', 'hidden');
        }
    },

    async handleLogin(e) {
        e.preventDefault();
        const form = e.target;
        if (!this.validateForm(form)) return;
        this.showLoading();
        try {
            await this.getRecaptchaToken('login');
            await signInWithEmailAndPassword(this.auth, form.email.value, form.password.value);
            this.trackEvent('login', { method: 'Email' });
            this.showToast('Login efetuado com sucesso!');
            this.closeAuthModal();
        } catch (error) { this.showToast(getFirebaseErrorMessage(error), 'error');
        } finally { this.hideLoading(); }
    },

    async handleRegister(e) {
        e.preventDefault();
        const form = e.target;
        if (!this.validateForm(form)) return;
        this.showLoading();
        try {
            await this.getRecaptchaToken('register');
            const userCredential = await createUserWithEmailAndPassword(this.auth, form.email.value, form.password.value);
            const newUserProfile = { email: userCredential.user.email, isAdmin: false, cart: [], loyaltyPoints: 0, wishlist: [] };
            await setDoc(doc(this.db, "users", userCredential.user.uid), newUserProfile);
            this.userProfile = newUserProfile;
            this.trackEvent('sign_up', { method: 'Email' });
            this.showToast('Conta criada com sucesso!');
            this.closeAuthModal();
            this.showWelcomePopup();
        } catch (error) { this.showToast(getFirebaseErrorMessage(error), 'error');
        } finally { this.hideLoading(); }
    },

    async handleForgotPassword() {
        const emailInput = document.getElementById('login-email');
        if (!emailInput || !emailInput.value) { this.showToast('Por favor, insira o seu email no campo de login primeiro.', 'error'); emailInput?.focus(); return; }
        const email = emailInput.value;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { this.showToast('Por favor, insira um email válido.', 'error'); return; }
        this.showLoading();
        try {
            await sendPasswordResetEmail(this.auth, email);
            this.showToast('Email de recuperação enviado para ' + email);
            this.closeAuthModal();
        } catch (error) { this.showToast(getFirebaseErrorMessage(error), 'error');
        } finally { this.hideLoading(); }
    },

    updateCartCountDisplay() {
        const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);

        // Update top header cart count
        const cartCount = document.getElementById('cart-count');
        if (cartCount) {
            cartCount.textContent = totalItems;
            cartCount.style.display = totalItems > 0 ? 'flex' : 'none';
        }

        // Update bottom nav cart count
        const bottomCartCount = document.getElementById('bottom-cart-count');
        if (bottomCartCount) {
            bottomCartCount.textContent = totalItems;
            bottomCartCount.style.display = totalItems > 0 ? 'flex' : 'none';
        }
    },

    async saveCart() {
        if (this.user) await this.saveCartToFirestore();
        else this.saveCartToLocalStorage();
    },

    async saveCartToFirestore() {
        if (!this.user) return;
        try {
            const cleanCart = JSON.parse(JSON.stringify(this.cart));
            await setDoc(doc(this.db, "users", this.user.uid), { cart: cleanCart }, { merge: true });
        } catch (error) { this.showToast('Não foi possível guardar o carrinho.', 'error'); }
    },

    async loadCartFromFirestore() {
        if (this.userProfile && Array.isArray(this.userProfile.cart)) {
            // Sanitize cart items to ensure they have the necessary properties for calculations.
            // This handles carts created before the `originalPrice` field was introduced.
            this.cart = this.userProfile.cart.map(item => {
                const sanitizedItem = { ...item };
                if (typeof sanitizedItem.originalPrice !== 'number') {
                    sanitizedItem.originalPrice = sanitizedItem.price;
                }
                if (typeof sanitizedItem.price !== 'number') {
                    sanitizedItem.price = 0;
                }
                return sanitizedItem;
            });
        } else {
            this.cart = [];
        }
        this.updateCartCountDisplay();
    },

    saveCartToLocalStorage() {
        try { localStorage.setItem('guestCart', JSON.stringify(this.cart)); }
        catch (e) { console.error("Could not save guest cart", e); }
    },

    loadCartFromLocalStorage() {
        try { const cartJson = localStorage.getItem('guestCart'); return cartJson ? JSON.parse(cartJson) : [];
        } catch (e) { return []; }
    },

    async mergeCarts(guestCart) {
        guestCart.forEach(guestItem => {
            const userItem = this.cart.find(item => item.id === guestItem.id);
            if (userItem) userItem.quantity += guestItem.quantity;
            else this.cart.push(guestItem);
        });
        await this.saveCartToFirestore();
        this.showToast('O seu carrinho foi atualizado com os itens que adicionou anteriormente.');
    },

    async addBundleToCart(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product || !product.bundle || !product.bundle.items) {
            this.showToast('Bundle não encontrado.', 'error');
            return;
        }

        this.showLoading();

        const bundleItems = [product, ...product.bundle.items.map(id => this.products.find(p => p.id === id)).filter(Boolean)];

        // First, check stock for all items in the bundle.
        const outOfStockItem = bundleItems.find(item => !item.stock || item.stock <= 0);
        if (outOfStockItem) {
            this.showToast(`Não é possível adicionar o bundle. O item "${outOfStockItem.name}" está esgotado.`, 'error');
            this.hideLoading();
            return;
        }

        const discount = product.bundle.discount || 0;
        let itemsAddedCount = 0;
        let itemsSkippedCount = 0;

        for (const itemProduct of bundleItems) {
            const cartItem = this.cart.find(item => item.id === itemProduct.id);
            if (cartItem) {
                itemsSkippedCount++;
                continue; // Skip item if already in cart to avoid price conflicts
            }

            const discountedPrice = itemProduct.price * (1 - discount / 100);
            const imageUrl = (itemProduct.images && itemProduct.images[0]) || itemProduct.image;
            this.cart.push({
                id: itemProduct.id,
                name: itemProduct.name,
                price: discountedPrice,
                originalPrice: itemProduct.price,
                image: imageUrl,
                quantity: 1,
                discountApplied: true
            });
            itemsAddedCount++;
        }

        let toastMessage = '';
        if (itemsAddedCount > 0) {
            toastMessage += `${itemsAddedCount} itens do bundle adicionados ao carrinho com ${discount}% de desconto!`;
        }
        if (itemsSkippedCount > 0) {
            toastMessage += ` (${itemsSkippedCount} item(ns) já estavam no carrinho e não foram adicionados novamente.)`;
        }
        this.showToast(toastMessage.trim(), 'success');

        await this.saveCart();
        this.updateCartCountDisplay();
        this.renderSidebarCart();
        this.openCartSidebar();
        this.hideLoading();
    },

    async addToCart(productId, finalPrice = null) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        // Check stock before adding to cart
        if (!product.stock || product.stock <= 0) {
            this.showToast('Este produto está fora de stock e não pode ser adicionado.', 'error');
            return;
        }

        const wasEmpty = this.cart.length === 0;
        const cartItem = this.cart.find(item => item.id === productId);

        if (cartItem) {
            // If item is already in cart, just increment quantity. Don't change the price.
            // This prevents a non-discounted item from becoming discounted if added again via a bundle.
            cartItem.quantity++;
        } else {
            const price = finalPrice !== null ? finalPrice : product.price;
            const imageUrl = (product.images && product.images[0]) || product.image;
            this.cart.push({
                id: product.id,
                name: product.name,
                price: price, // Final price
                originalPrice: product.price, // Base price
                image: imageUrl,
                quantity: 1,
                discountApplied: price < product.price
            });
        }

        this.trackEvent('add_to_cart', { currency: 'EUR', value: product.price, items: [{ item_id: product.id, item_name: product.name, price: product.price, quantity: 1 }] });
        await this.saveCart();
        this.showToast(`'${product.name}' adicionado ao carrinho!`);
        this.updateCartCountDisplay();
        const cartIcon = document.getElementById('cart-icon-container');
        cartIcon.classList.add('cart-animate');
        cartIcon.addEventListener('animationend', () => cartIcon.classList.remove('cart-animate'), {once: true});

        if (window.location.hash.includes('/cart')) {
            this.renderCartPage();
        }

        if (wasEmpty) this.openCartSidebar();
        if (document.getElementById('preview-modal')?.classList.contains('flex')) this.closePreviewModal();
    },

        async updateCartQuantity(productId, action) {
            const itemIndex = this.cart.findIndex(item => item.id === productId);
            if (itemIndex === -1) return;
            if (action === 'increase') this.cart[itemIndex].quantity++;
            else if (action === 'decrease') {
                this.cart[itemIndex].quantity--;
                if (this.cart[itemIndex].quantity <= 0) this.cart.splice(itemIndex, 1);
            }
            await this.saveCart();
            this.updateCartCountDisplay();
            this.renderSidebarCart();
            if (window.location.hash.includes('/cart')) this.renderCartPage();
        },

        async removeFromCart(productId) {
            this.cart = this.cart.filter(item => item.id !== productId);
            await this.saveCart();
            this.updateCartCountDisplay();
            this.renderSidebarCart();
            if (window.location.hash.includes('/cart')) this.renderCartPage();
        },

        openPreviewModal(productId) {
            const product = this.products.find(p => p.id === productId);
            if (!product) return;
            const modal = document.getElementById('preview-modal');
            const content = document.getElementById('preview-content');
            const imageUrl = (product.images && product.images[0]) || product.image;
            content.classList.add('grid', 'md:grid-cols-2', 'gap-6');
            content.innerHTML = `<h2 id="preview-heading" class="sr-only">Vista Rápida: ${product.name}</h2><button id="close-preview" class="absolute top-4 right-4 text-gray-400 hover:text-white z-10"><i class="fas fa-times text-2xl"></i></button><div><img src="${imageUrl}" alt="${product.name}" class="w-full h-auto object-cover rounded-lg" onerror="this.onerror=null;this.src='https://placehold.co/600x600/1a1a1a/e11d48?text=Indisponível';" loading="lazy"></div><div class="flex flex-col"><h3 class="text-3xl font-extrabold text-white mb-3">${product.name}</h3><p class="text-gray-300 text-lg mb-6">${product.description}</p><div class="mt-auto"><span class="text-4xl font-bold text-accent mb-6 block">€${product.price.toFixed(2)}</span><button data-id="${product.id}" class="add-to-cart-btn w-full btn btn-primary flex items-center justify-center gap-2 text-center"><i class="fas fa-shopping-cart"></i> Adicionar ao Carrinho</button></div></div>`;
            modal.classList.replace('hidden', 'flex');
            document.getElementById('close-preview').addEventListener('click', () => this.closePreviewModal());
            modal.addEventListener('click', (e) => { if (e.target.id === 'preview-modal') this.closePreviewModal(); });
        },

        closePreviewModal() {
            document.getElementById('preview-modal').classList.replace('flex', 'hidden');
            const content = document.getElementById('preview-content');
            content.classList.remove('grid', 'md:grid-cols-2', 'gap-6');
        },

        async applyFirstPurchaseDiscountIfNeeded() {
            if (!this.user || this.cart.length === 0 || this.discount.percentage > 0) return;

            await this.loadOrders();

            if (this.orders.length === 0) {
                this.discount = { code: 'BEMVINDO10', percentage: 10, amount: 0 };
                this.showToast('Desconto de 10% de primeira compra aplicado!', 'success');

                // Re-render the cart page if currently on it.
                if (window.location.hash.includes('/cart')) {
                    this.renderCartPage();
                }
                // For checkout, the summary will be updated by the calling function.
                // No need to re-render the whole page here.

                this.renderSidebarCart();
            }
        },

        showImageInModal(imageUrl) {
            const modal = document.getElementById('preview-modal');
            const content = document.getElementById('preview-content');
            content.classList.remove('grid', 'md:grid-cols-2', 'gap-6');
            content.innerHTML = `
                <button id="close-preview" class="absolute top-4 right-4 text-gray-400 hover:text-white z-10" aria-label="Fechar imagem"><i class="fas fa-times text-2xl"></i></button>
                <div class="flex items-center justify-center w-full h-full p-4"><img src="${imageUrl}" alt="Imagem do produto" class="max-w-full max-h-[80vh] object-contain rounded-lg shadow-lg" onerror="this.onerror=null;this.src='https://placehold.co/800x600/1a1a1a/e11d48?text=Imagem+Indisponível';this.alt='Imagem indisponível.'"></div>`;
            modal.classList.replace('hidden', 'flex');
            document.getElementById('close-preview').addEventListener('click', () => this.closePreviewModal());
            modal.addEventListener('click', (e) => { if (e.target.id === 'preview-modal') this.closePreviewModal(); });
        },

        renderCartPage() {
            const container = document.getElementById('cart-container');
            if (!container) return;
                    if (this.cart.length === 0) {
                        container.innerHTML = `<div class="w-full text-center py-16 bg-primary rounded-lg"><h2 class="text-2xl font-bold mb-4">O seu carrinho está vazio.</h2><a href="#/products" class="btn btn-primary">Continuar a Comprar</a></div>`;
                        return;
                    }

                    const itemsHtml = this.cart.map(item => {
                        const priceDisplay = item.discountApplied
                            ? `<span class="text-gray-500 line-through mr-2">€${item.originalPrice.toFixed(2)}</span><span class="text-accent font-bold text-lg">€${item.price.toFixed(2)}</span>`
                            : `<span class="text-accent font-bold text-lg">€${item.price.toFixed(2)}</span>`;
                        return `
                            <div class="flex items-center border-b border-gray-700 py-4" data-id="${item.id}">
                                <img src="${item.image}" alt="${item.name}" class="w-24 h-24 object-cover rounded-md mr-6" onerror="this.onerror=null;this.src='https://placehold.co/100x100/1a1a1a/e11d48?text=Img';" loading="lazy">
                                <div class="flex-1">
                                    <h3 class="text-lg font-semibold">${item.name}</h3>
                                    ${priceDisplay}
                                </div>
                                <div class="flex items-center gap-4">
                                    <div class="flex items-center border border-gray-600 rounded-md">
                                        <button class="quantity-change p-2" aria-label="Diminuir quantidade de ${item.name}" data-action="decrease">-</button>
                                        <span class="px-3" aria-live="polite">${item.quantity}</span>
                                        <button class="quantity-change p-2" aria-label="Aumentar quantidade de ${item.name}" data-action="increase">+</button>
                                    </div>
                                    <button class="remove-item text-gray-500 hover:text-red-500 transition" aria-label="Remover ${item.name} do carrinho"><i class="fas fa-trash-alt text-lg"></i></button>
                                </div>
                            </div>`;
                    }).join('');

                    const subtotal = this.cart.reduce((sum, item) => sum + (item.originalPrice * item.quantity), 0);
                    const bundleDiscount = subtotal - this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

                    const couponDiscountPercentage = this.discount.percentage || 0;
                    const priceAfterBundleDiscount = subtotal - bundleDiscount;
                    const couponDiscount = priceAfterBundleDiscount * (couponDiscountPercentage / 100);

                    const finalTotal = priceAfterBundleDiscount - couponDiscount;

            const recommendationsHtml = this.renderCartRecommendations();
                    container.innerHTML = `
                        <div class="w-full lg:w-2/3">
                            <div class="bg-primary rounded-lg shadow-lg p-6">${itemsHtml}</div>
                            ${recommendationsHtml}
                        </div>
                        <aside class="w-full lg:w-1/3">
                            <div class="bg-primary p-6 rounded-lg shadow-lg sticky top-28">
                                <h3 class="text-2xl font-bold mb-6 border-b border-gray-700 pb-4">Resumo do Pedido</h3>
                                <div class="space-y-4">
                                    <div class="flex justify-between"><span class="text-gray-400">Subtotal</span><span class="font-semibold">€${subtotal.toFixed(2)}</span></div>
                                    <div class="flex justify-between ${bundleDiscount > 0 ? '' : 'hidden'}" id="cart-bundle-discount-line">
                                        <span class="text-gray-400">Desconto do Bundle</span><span class="font-semibold text-green-400">- €${bundleDiscount.toFixed(2)}</span>
                                    </div>
                                    <div class="flex justify-between ${couponDiscount > 0 ? '' : 'hidden'}" id="cart-coupon-discount-line">
                                        <span class="text-gray-400">Desconto do Cupão (${this.discount.code})</span><span class="font-semibold text-green-400">- €${couponDiscount.toFixed(2)}</span>
                                    </div>
                                    <div class="flex justify-between border-t border-gray-700 pt-4"><span class="text-lg font-bold">Total</span><span class="text-lg font-bold">€${finalTotal.toFixed(2)}</span></div>
                                </div>
                                <div class="mt-6 pt-4 border-t border-gray-700">
                                    <label for="discount-code-input" class="block text-gray-300 mb-2 font-semibold">Código de Desconto</label>
                                    <div class="flex">
                                        <input type="text" id="discount-code-input" placeholder="Insira o seu cupão" class="w-full bg-gray-800 text-white px-4 py-2 rounded-l-md focus:outline-none focus:ring-2 focus:ring-accent form-input">
                                        <button id="apply-discount-btn" class="btn btn-secondary px-4 rounded-l-none">Aplicar</button>
                                    </div>
                                    <p id="discount-message" class="text-sm mt-2 h-4"></p>
                                </div>
                                <a href="#/checkout" class="w-full btn btn-primary mt-6 text-center block">Finalizar Compra</a>
                            </div>
                        </aside>`;
        },

        initCartSidebar() {
            const cartIcon = document.getElementById('cart-icon-container');
            const closeBtn = document.getElementById('close-cart-btn');
            const overlay = document.getElementById('cart-overlay');
            const sidebar = document.getElementById('cart-sidebar');
            cartIcon.addEventListener('click', (e) => { e.preventDefault(); this.openCartSidebar(); });
            closeBtn.addEventListener('click', () => this.closeCartSidebar());
            overlay.addEventListener('click', () => this.closeCartSidebar());
            sidebar.addEventListener('click', (e) => { const target = e.target.closest('a'); if(target && (target.href.includes('#/cart') || target.href.includes('#/checkout'))) this.closeCartSidebar(); });
        },

        openCartSidebar() {
            this.renderSidebarCart();
            document.getElementById('cart-sidebar').classList.remove('translate-x-full');
            document.getElementById('cart-overlay').classList.remove('hidden');
            document.body.style.overflow = 'hidden';
        },

        closeCartSidebar() {
            document.getElementById('cart-sidebar').classList.add('translate-x-full');
            document.getElementById('cart-overlay').classList.add('hidden');
            document.body.style.overflow = '';
        },

        renderSidebarCart() {
            const contentEl = document.getElementById('cart-sidebar-content');
            const footerEl = document.getElementById('cart-sidebar-footer');
            if (!contentEl || !footerEl) return;
            if (this.cart.length === 0) {
                contentEl.innerHTML = `<div class="text-center py-16"><p class="text-gray-400">O seu carrinho está vazio.</p></div>`;
                footerEl.innerHTML = `<a href="#/products" class="w-full btn btn-primary text-center block" onclick="app.closeCartSidebar()">Continuar a comprar</a>`;
                return;
            }

                    const itemsHtml = this.cart.map(item => {
                        const priceDisplay = item.discountApplied
                            ? `<p><span class="text-gray-500 line-through mr-1">€${item.originalPrice.toFixed(2)}</span><span class="text-accent font-bold">€${item.price.toFixed(2)}</span></p>`
                            : `<p class="text-accent font-bold">€${item.price.toFixed(2)}</p>`;
                        return `
                            <div class="flex items-start gap-4 py-4 border-b border-gray-800" data-id="${item.id}">
                                <img src="${item.image}" alt="${item.name}" class="w-20 h-20 object-cover rounded-md" onerror="this.onerror=null;this.src='https://placehold.co/100x100/1a1a1a/e11d48?text=Img';" loading="lazy">
                                <div class="flex-1">
                                    <h3 class="font-semibold">${item.name}</h3>
                                    ${priceDisplay}
                                    <div class="flex items-center border border-gray-600 rounded-md mt-2 w-fit">
                                        <button class="quantity-change p-2 text-lg" aria-label="Diminuir quantidade de ${item.name}" data-action="decrease">-</button>
                                        <span class="px-3" aria-live="polite">${item.quantity}</span>
                                        <button class="quantity-change p-2 text-lg" aria-label="Aumentar quantidade de ${item.name}" data-action="increase">+</button>
                                    </div>
                                </div>
                                <button class="remove-item text-gray-500 hover:text-red-500 transition" aria-label="Remover ${item.name} do carrinho"><i class="fas fa-trash-alt"></i></button>
                            </div>`;
                    }).join('');
            contentEl.innerHTML = itemsHtml;

                    const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                    const couponDiscount = subtotal * ((this.discount.percentage || 0) / 100);
                    const finalTotal = subtotal - couponDiscount;

                    footerEl.innerHTML = `
                        <div class="flex justify-between items-center mb-4">
                            <span class="text-lg font-bold">Total</span>
                            <span class="text-lg font-bold text-accent">€${finalTotal.toFixed(2)}</span>
                        </div>
                        <p class="text-xs text-gray-500 text-center mb-4">Portes e taxas calculados no checkout.</p>
                        <div class="space-y-3">
                            <a href="#/cart" class="w-full btn btn-secondary text-center block">Ver Carrinho</a>
                            <a href="#/checkout" class="w-full btn btn-primary text-center block">Finalizar Compra</a>
                        </div>`;
        },

        async handleApplyDiscount(codeInputId, messageId) {
            const discountCodeInput = document.getElementById(codeInputId);
            const discountMessage = document.getElementById(messageId);
            const code = discountCodeInput.value.trim().toUpperCase();

            this.discount = { code: '', percentage: 0, amount: 0 };
            if (discountMessage) {
                discountMessage.textContent = '';
                discountMessage.classList.remove('text-green-400', 'text-red-400');
            }

            if (!code) {
                this.showToast('Nenhum código de desconto inserido.', 'error');
            } else if (code === 'BEMVINDO10') {
                if (!this.user) {
                    this.showToast('Faça login para usar este cupão.', 'error');
                    this.openAuthModal('login');
                    return;
                }
                await this.loadOrders();
                if (this.orders.length > 0) {
                    if (discountMessage) {
                        discountMessage.textContent = 'Cupão apenas para a primeira compra.';
                        discountMessage.classList.add('text-red-400');
                    }
                    this.showToast('Este cupão é válido apenas na primeira compra.', 'error');
                } else {
                    this.discount = { code: code, percentage: 10, amount: 0 };
                    if (discountMessage) {
                        discountMessage.textContent = `Desconto de 10% aplicado!`;
                        discountMessage.classList.add('text-green-400');
                    }
                    this.showToast('Desconto aplicado com sucesso!', 'success');
                }
            } else if (code === 'DESCONTO10') {
                this.discount = { code: code, percentage: 10, amount: 0 };
                if (discountMessage) {
                    discountMessage.textContent = `Desconto de 10% aplicado!`;
                    discountMessage.classList.add('text-green-400');
                }
                this.showToast('Desconto aplicado com sucesso!', 'success');
            } else if (code === 'PRAZER5') {
                this.discount = { code: code, percentage: 5, amount: 0 };
                if (discountMessage) {
                    discountMessage.textContent = `Desconto de 5% aplicado!`;
                    discountMessage.classList.add('text-green-400');
                }
                this.showToast('Desconto aplicado com sucesso!', 'success');
            } else {
                if (discountMessage) {
                    discountMessage.textContent = 'Código de desconto inválido.';
                    discountMessage.classList.add('text-red-400');
                }
                this.showToast('Código de desconto inválido.', 'error');
            }

            this.renderSidebarCart();
            if (window.location.hash.includes('/cart')) {
                this.renderCartPage();
            }
        },

        applyDiscount() {
            this.handleApplyDiscount('discount-code-input', 'discount-message');
        },

        applyDiscountSidebar() {
            this.handleApplyDiscount('sidebar-discount-code-input', 'sidebar-discount-message');
        },

        applyLoyaltyPoints() {
            const input = document.getElementById('loyalty-points-input');
            const messageEl = document.getElementById('loyalty-message');
            const pointsToRedeem = parseInt(input.value);

            messageEl.textContent = '';
            messageEl.classList.remove('text-green-400', 'text-red-400');

            if (isNaN(pointsToRedeem) || pointsToRedeem <= 0) {
                this.showToast('Por favor, insira um número válido de pontos.', 'error');
                messageEl.textContent = 'Número inválido.';
                messageEl.classList.add('text-red-400');
                return;
            }

            if (pointsToRedeem > this.userProfile.loyaltyPoints) {
                this.showToast('Não tem pontos suficientes.', 'error');
                messageEl.textContent = 'Pontos insuficientes.';
                messageEl.classList.add('text-red-400');
                return;
            }

            const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
            const couponDiscount = subtotal * ((this.discount.percentage || 0) / 100);
            const maxRedeemableValue = subtotal - couponDiscount;

            const loyaltyDiscountAmount = pointsToRedeem / 100; // 100 points = 1€

            if (loyaltyDiscountAmount > maxRedeemableValue) {
                this.showToast(`Não pode resgatar mais do que o valor do seu pedido.`, 'error');
                messageEl.textContent = `Máximo de €${maxRedeemableValue.toFixed(2)} resgatável.`;
                messageEl.classList.add('text-red-400');
                return;
            }

            this.loyalty.pointsUsed = pointsToRedeem;
            this.loyalty.discountAmount = loyaltyDiscountAmount;

            this.showToast(`Desconto de €${loyaltyDiscountAmount.toFixed(2)} aplicado!`);
            messageEl.textContent = `€${loyaltyDiscountAmount.toFixed(2)} de desconto aplicado!`;
            messageEl.classList.add('text-green-400');
            this.updateCheckoutSummary();
        },

    renderCartRecommendations() {
        const cartItemIds = this.cart.map(item => item.id);
        const recommendedProducts = this.products.filter(p => !cartItemIds.includes(p.id)).sort(() => 0.5 - Math.random()).slice(0, 2);
        if (recommendedProducts.length === 0) return '';
        return `<div id="cart-recommendations" class="mt-8 bg-primary p-6 rounded-lg"><h3 class="text-xl font-bold mb-4">💕 Também poderá gostar:</h3><div class="grid grid-cols-2 sm:grid-cols-2 gap-4">${recommendedProducts.map(p => renderProductCard(p, this.isProductInWishlist.bind(this))).join('')}</div></div>`;
    },

    initFilters(params) {
        if (this.products.length === 0) return;

        // Reset filters before applying from URL
        this.filters = { category: 'all', minPrice: 0, maxPrice: 0, brand: [], color: [], material: [] };

        // --- Category Filter ---
        this.filters.category = params.get('category') || 'all';
        const categories = ['all', ...new Set(this.products.map(p => p.category).filter(Boolean))];
        const categoryList = document.getElementById('category-filter-list');
        if (categoryList) {
            categoryList.innerHTML = categories.map(cat => `<li><a href="javascript:void(0)" class="category-filter-btn block hover:text-accent transition-colors ${cat === this.filters.category ? 'text-accent font-bold' : ''}" data-category="${cat}">${cat.charAt(0).toUpperCase() + cat.slice(1).replace(/-/g, ' ')}</a></li>`).join('');
        }

        // --- Advanced Checkbox Filters ---
        const renderCheckboxFilter = (filterType, containerId) => {
            const container = document.getElementById(containerId);
            if (!container) return;
            const options = [...new Set(this.products.map(p => p[filterType]).filter(p => p && p !== 'N/A'))].sort();
            if (options.length === 0) {
                container.innerHTML = `<p class="text-sm text-gray-500" data-i18n="noFilterOptions">Nenhuma opção.</p>`;
                return;
            }

            const selectedValues = params.get(filterType)?.split(',') || [];
            this.filters[filterType] = selectedValues; // Set filter state

            container.innerHTML = options.map(option => {
                const isChecked = selectedValues.includes(option);
                return `
                <label class="flex items-center space-x-3 cursor-pointer text-gray-300 hover:text-accent">
                    <input type="checkbox" value="${option}" data-filter-type="${filterType}" class="advanced-filter-checkbox h-4 w-4 rounded border-gray-600 bg-gray-700 text-accent focus:ring-accent" ${isChecked ? 'checked' : ''}>
                    <span>${option}</span>
                </label>
            `}).join('');
        };

        renderCheckboxFilter('brand', 'brand-filter-list');
        renderCheckboxFilter('color', 'color-filter-list');
        renderCheckboxFilter('material', 'material-filter-list');

        // --- Price Slider ---
        const prices = this.products.map(p => p.price);
        const minPriceDefault = Math.floor(Math.min(...prices, 0));
        const maxPriceDefault = Math.ceil(Math.max(...prices, 100));

        let initialMin = minPriceDefault;
        let initialMax = maxPriceDefault;

        const initialPriceRange = params.get('price');
        if (initialPriceRange) {
            const [min, max] = initialPriceRange.split('-').map(Number);
            if (!isNaN(min) && !isNaN(max)) {
                initialMin = min;
                initialMax = max;
            }
        }

        this.filters.minPrice = initialMin;
        this.filters.maxPrice = initialMax;

        const minSlider = document.getElementById('min-price-slider');
        const maxSlider = document.getElementById('max-price-slider');
        const minDisplay = document.getElementById('min-price-display');
        const maxDisplay = document.getElementById('max-price-display');
        const rangeTrack = document.getElementById('price-range-track');

        if (!minSlider) return;

        minSlider.min = maxSlider.min = minPriceDefault;
        minSlider.max = maxSlider.max = maxPriceDefault;
        minSlider.value = initialMin;
        maxSlider.value = initialMax;
        minDisplay.textContent = `€${initialMin}`;
        maxDisplay.textContent = `€${initialMax}`;

        const updateRangeTrack = () => {
            const minVal = parseInt(minSlider.value), maxVal = parseInt(maxSlider.value), range = maxPriceDefault - minPriceDefault;
            if (range === 0) return;
            const minPercent = ((minVal - minPriceDefault) / range) * 100;
            const maxPercent = ((maxVal - minPriceDefault) / range) * 100;
            rangeTrack.style.left = `${minPercent}%`;
            rangeTrack.style.width = `${maxPercent - minPercent}%`;
        };
        updateRangeTrack();

        const sliderInputHandler = (e, isMin) => {
            if (isMin) { if (parseInt(minSlider.value) > parseInt(maxSlider.value)) minSlider.value = maxSlider.value; this.filters.minPrice = parseInt(minSlider.value); minDisplay.textContent = `€${this.filters.minPrice}`; }
            else { if (parseInt(maxSlider.value) < parseInt(minSlider.value)) maxSlider.value = minSlider.value; this.filters.maxPrice = parseInt(maxSlider.value); maxDisplay.textContent = `€${this.filters.maxPrice}`; }
            updateRangeTrack(); this.applyFilters();
        };
        minSlider.addEventListener('input', (e) => sliderInputHandler(e, true));
        maxSlider.addEventListener('input', (e) => sliderInputHandler(e, false));
    },

    applyFilters(isInitialLoad = false) {
        const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || '';
        let filtered = [...this.products];

        // Filter by search term if present
        if (searchTerm) {
            filtered = filtered.filter(p => p.name.toLowerCase().includes(searchTerm) || p.description.toLowerCase().includes(searchTerm));
        }

        // Filter by category
        if (this.filters.category && this.filters.category !== 'all') {
            filtered = filtered.filter(p => p.category === this.filters.category);
        }

        // Advanced Filters
        ['brand', 'color', 'material'].forEach(filterType => {
            if (this.filters[filterType] && this.filters[filterType].length > 0) {
                filtered = filtered.filter(p => this.filters[filterType].includes(p[filterType]));
            }
        });

        // Price Filter
        filtered = filtered.filter(p => p.price >= this.filters.minPrice && p.price <= this.filters.maxPrice);

        // Sorting logic
        const sortBy = document.getElementById('sort')?.value || 'popularity';
        filtered.sort((a, b) => {
            if (sortBy === 'price-asc') return a.price - b.price;
            if (sortBy === 'price-desc') return b.price - a.price;
            if (sortBy === 'popularity') return (b.averageRating || 0) - (a.averageRating || 0);
            return 0;
        });

        this.filteredProducts = filtered;
        this.currentPage = 1;
        this.renderCurrentProductPage();

        if (isInitialLoad) return;
        this.updateProductURL();
    },

    updateProductURL() {
        const params = new URLSearchParams();
        if (this.filters.category && this.filters.category !== 'all') params.set('category', this.filters.category);
        ['brand', 'color', 'material'].forEach(filterType => {
            if (this.filters[filterType] && this.filters[filterType].length > 0) params.set(filterType, this.filters[filterType].join(','));
        });
        const prices = this.products.map(p => p.price);
        const minPriceDefault = this.products.length > 0 ? Math.floor(Math.min(...prices, 0)) : 0;
        const maxPriceDefault = this.products.length > 0 ? Math.ceil(Math.max(...prices, 100)) : 100;
        if (this.filters.minPrice > minPriceDefault || this.filters.maxPrice < maxPriceDefault) params.set('price', `${this.filters.minPrice}-${this.filters.maxPrice}`);
        const searchTerm = document.getElementById('search-input')?.value;
        if (searchTerm) params.set('q', searchTerm);
        const sortBy = document.getElementById('sort')?.value;
        if (sortBy && sortBy !== 'popularity') params.set('sort', sortBy);

        const newHash = params.toString() ? `products?${params.toString()}` : 'products';
        if(window.location.hash !== `#/${newHash}`) {
            history.replaceState(null, '', `#/${newHash}`);
        }
    },

    renderCurrentProductPage() {
        const startIndex = (this.currentPage - 1) * this.productsPerPage;
        const endIndex = startIndex + this.productsPerPage;
        const productsToShow = this.filteredProducts.slice(startIndex, endIndex);

        renderAllProducts(productsToShow, this.isProductInWishlist.bind(this));
        this.renderPaginationControls();
        this.updateProductCount();
    },

    updateProductCount() {
        const countEl = document.getElementById('product-count');
        if (!countEl) return;
        const total = this.filteredProducts.length;
        if (total === 0) {
            countEl.textContent = this.getTranslation('noProductsFound');
            return;
        }
        const startIndex = (this.currentPage - 1) * this.productsPerPage + 1;
        const endIndex = Math.min(startIndex + this.productsPerPage - 1, total);

        countEl.textContent = this.getTranslation('productCount', {
            shown: `${startIndex}-${endIndex}`,
            total: total
        });
    },

    renderPaginationControls() {
        const container = document.getElementById('pagination-controls');
        if (!container) return;

        const totalPages = Math.ceil(this.filteredProducts.length / this.productsPerPage);
        if (totalPages <= 1) {
            container.innerHTML = '';
            return;
        }

        let buttonsHtml = '';
        // Previous button
        buttonsHtml += `<button class="pagination-btn" ${this.currentPage === 1 ? 'disabled' : ''} data-page="${this.currentPage - 1}"><i class="fas fa-arrow-left"></i></button>`;

        // Page number buttons
        for (let i = 1; i <= totalPages; i++) {
            buttonsHtml += `<button class="pagination-btn ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }

        // Next button
        buttonsHtml += `<button class="pagination-btn" ${this.currentPage === totalPages ? 'disabled' : ''} data-page="${this.currentPage + 1}"><i class="fas fa-arrow-right"></i></button>`;

        container.innerHTML = buttonsHtml;

        container.querySelectorAll('.pagination-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.goToPage(parseInt(e.currentTarget.dataset.page));
            });
        });
    },

    goToPage(pageNum) {
        this.currentPage = pageNum;
        this.renderCurrentProductPage();
        document.getElementById('product-content-area')?.scrollIntoView({ behavior: 'smooth' });
    },

    initProductSorting() { document.getElementById('sort')?.addEventListener('change', () => this.applyFilters()); },

    showPurchaseSuccessModal() {
        const modal = document.getElementById('purchase-success-modal');
        if (!modal) return;

        const content = modal.querySelector('.transform');
        const close = () => {
            content.classList.remove('opacity-100', 'scale-100');
            setTimeout(() => {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }, 300);
        };

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        setTimeout(() => {
            content.classList.add('opacity-100', 'scale-100');
        }, 10);

        // Close modal if user clicks outside of it
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                close();
            }
        });

        // Make sure the buttons also close the modal before navigating
        document.getElementById('view-orders-btn').addEventListener('click', close);
        document.getElementById('continue-shopping-btn').addEventListener('click', close);
    },

    async initAccountPage(initialTab = 'dashboard') {
        if (sessionStorage.getItem('paymentSuccess')) {
            this.showPurchaseSuccessModal();
            sessionStorage.removeItem('paymentSuccess');
        }

        const navContainer = document.getElementById('account-nav');
        const contentArea = document.getElementById('account-content-area');
        if (!navContainer || !contentArea || !this.userProfile) return;
        document.getElementById('account-username').textContent = this.userProfile.firstName || this.user.email;
        const navItems = [ { id: 'dashboard', icon: 'fa-tachometer-alt', label: 'Painel' }, { id: 'orders', icon: 'fa-box', label: 'Encomendas' }, { id: 'wishlist', icon: 'fa-heart', label: 'Wishlist' }, { id: 'details', icon: 'fa-user-edit', label: 'Detalhes' }, { id: 'address', icon: 'fa-map-marker-alt', label: 'Endereço' } ];
        navContainer.innerHTML = `${navItems.map(item => `<a href="#/account?tab=${item.id}" data-tab="${item.id}" class="account-nav-link flex-1 text-center font-semibold p-3 rounded-md flex items-center justify-center gap-3 transition-colors"><i class="fas ${item.icon} w-5"></i><span class="hidden sm:inline">${item.label}</span></a>`).join('')}
            ${this.userProfile?.isAdmin ? `<a href="#/admin" class="account-nav-link flex-1 text-center font-semibold p-3 rounded-md flex items-center justify-center gap-3 transition-colors"><i class="fas fa-user-shield w-5"></i><span class="hidden sm:inline">Admin</span></a>` : ''}
            <button id="logout-button" class="account-nav-link flex-1 text-center font-semibold p-3 rounded-md flex items-center justify-center gap-3 transition-colors text-red-400 hover:bg-red-500/20"><i class="fas fa-sign-out-alt w-5"></i><span class="hidden sm:inline">Sair</span></button>`;
        const changeTab = async (tabId) => {
            this.showLoading();
            document.querySelectorAll('#account-nav [data-tab]').forEach(nav => nav.classList.remove('bg-accent', 'text-white'));
            const activeLink = document.querySelector(`[data-tab="${tabId}"]`);
            if(activeLink) activeLink.classList.add('bg-accent', 'text-white');

            const templateNode = await this.getTemplate(`account-${tabId}`);
            if (templateNode) {
                contentArea.innerHTML = templateNode.innerHTML;
                if (tabId === 'orders') await this.renderOrderHistory();
                if (tabId === 'details') this.initAccountDetailsForm();
                if (tabId === 'address') this.initAccountAddressForm();
                if (tabId === 'wishlist') this.renderWishlistPage();
                if (tabId === 'dashboard') {
                    const pointsEl = document.getElementById('loyalty-points-display');
                    if (pointsEl) {
                        pointsEl.textContent = this.userProfile.loyaltyPoints || 0;
                    }
                }
            } else {
                contentArea.innerHTML = '<p class="text-red-500">Erro ao carregar o conteúdo.</p>';
            }
            this.hideLoading();
        };
        navContainer.addEventListener('click', (e) => {
            const link = e.target.closest('[data-tab]');
            if (link) {
                e.preventDefault();
                const tabId = link.dataset.tab;
                history.pushState(null, '', `#/account?tab=${tabId}`);
                changeTab(tabId);
            }
        });
        document.getElementById('logout-button')?.addEventListener('click', () => logout(this.auth));
        const tabFromUrl = new URLSearchParams(window.location.hash.split('?')[1]).get('tab');
        await changeTab(tabFromUrl || initialTab);
    },

    async renderWishlistPage() {
        const container = document.getElementById('wishlist-grid');
        if (!container) return;

        const wishlistIds = this.userProfile?.wishlist || [];

        if (wishlistIds.length === 0) {
            container.innerHTML = '<p class="text-gray-400 col-span-full">A sua lista de desejos está vazia.</p>';
            return;
        }

        const wishlistProducts = this.products.filter(p => wishlistIds.includes(p.id));

        container.innerHTML = wishlistProducts.length > 0
            ? wishlistProducts.map(p => renderProductCard(p, this.isProductInWishlist.bind(this))).join('')
            : '<p class="text-gray-400 col-span-full">Não foi possível encontrar os produtos da sua lista. Tente novamente mais tarde.</p>';
    },

    initAccountDetailsForm() {
        const form = document.getElementById('account-details-form');
        if (!form || !this.userProfile) return;
        form.elements['firstName'].value = this.userProfile.firstName || ''; form.elements['lastName'].value = this.userProfile.lastName || '';
        form.elements['email'].value = this.user.email || '';
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (this.validateForm(form)) {
                this.showLoading();
                try {
                    const data = { firstName: form.elements['firstName'].value, lastName: form.elements['lastName'].value };
                    await setDoc(doc(this.db, "users", this.user.uid), data, { merge: true });
                    await this.loadUserProfile();
                    this.showToast('Detalhes guardados com sucesso!');
                } catch (error) { this.showToast('Erro ao guardar os detalhes.', 'error');
                } finally { this.hideLoading(); }
            }
        });

        const exportButton = document.getElementById('export-data-btn');
        if (exportButton) {
            exportButton.addEventListener('click', () => this.exportUserData());
        }
    },

    initAccountAddressForm() {
        const form = document.getElementById('account-address-form');
        if (!form || !this.userProfile) return;
        form.elements['address'].value = this.userProfile.address?.address || '';
        form.elements['city'].value = this.userProfile.address?.city || '';
        form.elements['zip'].value = this.userProfile.address?.zip || '';
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (this.validateForm(form)) {
                this.showLoading();
                try {
                    const data = { address: { address: form.elements['address'].value, city: form.elements['city'].value, zip: form.elements.zip.value, } };
                    await setDoc(doc(this.db, "users", this.user.uid), data, { merge: true });
                    await this.loadUserProfile();
                    this.showToast('Endereço guardado com sucesso!');
                } catch (error) { this.showToast('Erro ao guardar o endereço.', 'error');
                } finally { this.hideLoading(); }
            }
        });
    },

    async renderOrderHistory() {
        const orderListEl = document.getElementById('order-history-list');
        if (!orderListEl) return;
        await this.loadOrders();
        if (this.orders.length === 0) {
            orderListEl.innerHTML = `<p class="text-gray-400">Ainda não fez nenhuma encomenda.</p>`;
            return;
        }
        orderListEl.innerHTML = this.orders.map(order => {
            const dateObj = order.createdAt?.toDate() || order.timestamp?.toDate();
            const orderDate = dateObj ? new Date(dateObj).toLocaleDateString('pt-PT') : 'Data Indisponível';
            const status = order.status || 'Pendente';
            return `
            <div class="bg-secondary rounded-lg overflow-hidden">
                <button class="accordion-header w-full flex justify-between items-center p-4 text-left gap-4">
                    <span class="font-bold text-white text-sm">#${order.id.substring(0, 8).toUpperCase()}</span>
                    <span class="text-gray-400 hidden sm:inline">${orderDate}</span>
                    <span class="font-semibold text-white flex-1 text-right">€${order.total.toFixed(2)}</span>
                    <span class="py-1 px-3 rounded-full text-xs font-bold whitespace-nowrap ${this.getStatusColor(status)}">${status}</span>
                    <i class="fas fa-chevron-down text-gray-400"></i>
                </button>
                <div class="accordion-body border-t border-gray-700">
                   <div class="p-4">
                        <h4 class="font-bold mb-2 text-accent">Itens da Encomenda</h4>
                        <ul class="space-y-1 text-gray-300">
                            ${order.items.map(item => {
                                const imageUrl = (item.images && item.images[0]) || item.image;
                                return `<li class="flex items-center justify-between"><div class="flex items-center"><img src="${imageUrl}" alt="${item.name}" class="w-10 h-10 object-cover rounded-md mr-2 cursor-pointer order-item-image" data-image-url="${imageUrl}" onerror="this.onerror=null;this.src='https://placehold.co/40x40/2d2d2d/f1f1f1?text=Img';" loading="lazy"><span>${item.name} <span class="text-gray-500">x${item.quantity}</span></span></div><span>€${item.price.toFixed(2)}</span></li>`
                            }).join('')}
                        </ul>
                        <p class="text-right font-bold text-white mt-4">Total: €${order.total.toFixed(2)}</p>
                   </div>
                </div>
            </div>`;
        }).join('');
    },

    toggleAccordion(header) {
        const body = header.nextElementSibling;
        header.classList.toggle('open'); // For icon rotation

        if (header.classList.contains('open')) {
            // To open
            body.style.maxHeight = body.scrollHeight + "px";
        } else {
            // To close
            body.style.maxHeight = null;
        }
    },

    async loadOrders() {
        if (!this.user) return;
        this.showLoading();
        try {
            const q = query(collection(this.db, "orders"), where("userId", "==", this.user.uid));
            const querySnapshot = await getDocs(q);
            this.orders = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            this.orders.sort((a, b) => {
                const dateA = a.createdAt?.toDate() || a.timestamp?.toDate() || 0;
                const dateB = b.createdAt?.toDate() || b.timestamp?.toDate() || 0;
                return dateB - dateA;
            });
        } catch (error) { console.error("Erro detalhado ao carregar encomendas:", error); this.showToast('Erro ao carregar o seu histórico de encomendas.', 'error');
        } finally { this.hideLoading(); }
    },

    async renderCheckoutPage(params) {
        if (this.cart.length === 0 && !params.get('payment_intent_client_secret')) {
            const container = document.querySelector('#app-root .container');
            if (container) container.innerHTML = `<div class="w-full text-center py-16 bg-primary rounded-lg"><h2 class="text-2xl font-bold mb-4">O seu carrinho está vazio.</h2><a href="#/products" class="btn btn-primary">Começar a Comprar</a></div>`;
            return;
        }

        // Reset loyalty discount when the checkout page is first rendered.
        this.loyalty = { pointsUsed: 0, discountAmount: 0 };

        this.applyFirstPurchaseDiscountIfNeeded();
        this.updateCheckoutSummary();
        this.populateCheckoutForm();
        this.updateCheckoutView();

        const loyaltyPointsEl = document.getElementById('loyalty-points-available');
        const loyaltySection = document.getElementById('loyalty-section');

        if (this.userProfile && this.userProfile.loyaltyPoints > 0) {
            if (loyaltyPointsEl) {
                loyaltyPointsEl.textContent = Math.floor(this.userProfile.loyaltyPoints);
            }
            if (loyaltySection) {
                loyaltySection.classList.remove('hidden');
            }
        } else {
            if (loyaltySection) {
                loyaltySection.classList.add('hidden');
            }
        }
    },

    async initSearchPage(params) {
        const searchTerm = (params.get('q') || '').toLowerCase();
        const headingEl = document.getElementById('search-results-heading');
        const countEl = document.getElementById('search-results-count');
        const gridEl = document.getElementById('search-results-grid');
        const filtersEl = document.getElementById('search-filters-container');

        if (headingEl) headingEl.textContent = `Resultados para "${searchTerm}"`;

        if (!searchTerm) {
            if (countEl) countEl.textContent = '';
            if (gridEl) gridEl.innerHTML = '<p class="text-gray-400">Por favor, introduza um termo de pesquisa.</p>';
            if (filtersEl) filtersEl.innerHTML = '';
            return;
        }

        const initialResults = this.products.filter(p =>
            p.name.toLowerCase().includes(searchTerm) ||
            p.description.toLowerCase().includes(searchTerm) ||
            p.category.toLowerCase().includes(searchTerm) ||
            (p.brand && p.brand.toLowerCase().includes(searchTerm))
        );

        this.currentSearchResults = initialResults; // Store initial results
        this.renderSearchFilters(initialResults);
        this.applySearchFilters();
    },

    renderSearchFilters(results) {
        const filtersContainer = document.getElementById('search-filters-container');
        if (!filtersContainer) return;

        const brandCounts = {};
        const categoryCounts = {};

        results.forEach(p => {
            if (p.brand) brandCounts[p.brand] = (brandCounts[p.brand] || 0) + 1;
            if (p.category) categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
        });

        let filtersHtml = '';
        if (Object.keys(brandCounts).length > 1) {
            filtersHtml += `<div><h4 class="font-semibold mb-3">Marca</h4><div class="space-y-2">`;
            for (const brand in brandCounts) {
                filtersHtml += `<label class="flex items-center space-x-3 cursor-pointer text-gray-300 hover:text-accent">
                    <input type="checkbox" value="${brand}" data-filter-type="brand" class="search-filter-checkbox h-4 w-4 rounded border-gray-600 bg-gray-700 text-accent focus:ring-accent">
                    <span>${brand} <span class="text-xs text-gray-500">(${brandCounts[brand]})</span></span>
                </label>`;
            }
            filtersHtml += `</div></div>`;
        }
        if (Object.keys(categoryCounts).length > 1) {
            filtersHtml += `<div><h4 class="font-semibold mb-3">Categoria</h4><div class="space-y-2">`;
            for (const category in categoryCounts) {
                filtersHtml += `<label class="flex items-center space-x-3 cursor-pointer text-gray-300 hover:text-accent">
                    <input type="checkbox" value="${category}" data-filter-type="category" class="search-filter-checkbox h-4 w-4 rounded border-gray-600 bg-gray-700 text-accent focus:ring-accent">
                    <span>${category.charAt(0).toUpperCase() + category.slice(1)} <span class="text-xs text-gray-500">(${categoryCounts[category]})</span></span>
                </label>`;
            }
            filtersHtml += `</div></div>`;
        }

        filtersContainer.innerHTML = filtersHtml || '<p class="text-sm text-gray-500">Não há filtros para estes resultados.</p>';

        filtersContainer.querySelectorAll('.search-filter-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', () => this.applySearchFilters());
        });
    },

    applySearchFilters() {
        const gridEl = document.getElementById('search-results-grid');
        const countEl = document.getElementById('search-results-count');
        if (!gridEl || !countEl) return;

        const activeFilters = { brand: [], category: [] };
        document.querySelectorAll('.search-filter-checkbox:checked').forEach(checkbox => {
            activeFilters[checkbox.dataset.filterType].push(checkbox.value);
        });

        let filteredResults = [...this.currentSearchResults];

        if (activeFilters.brand.length > 0) {
            filteredResults = filteredResults.filter(p => activeFilters.brand.includes(p.brand));
        }
        if (activeFilters.category.length > 0) {
            filteredResults = filteredResults.filter(p => activeFilters.category.includes(p.category));
        }

        gridEl.innerHTML = filteredResults.length > 0
            ? filteredResults.map(p => renderProductCard(p, this.isProductInWishlist.bind(this))).join('')
            : '<p class="text-gray-400 col-span-full text-center">Nenhum produto corresponde aos filtros selecionados.</p>';

        countEl.textContent = `${filteredResults.length} ${filteredResults.length === 1 ? 'resultado encontrado' : 'resultados encontrados'}`;
    },

    updateCheckoutView() {
        [1, 2, 3].forEach(step => {
            document.getElementById(`checkout-step-${step}`).classList.toggle('hidden', step !== this.checkoutStep);
            const pStep = document.getElementById(`step-${['shipping', 'payment', 'review'][step-1]}`);
            if(pStep){
                pStep.classList.toggle('active', step === this.checkoutStep);
                pStep.classList.toggle('completed', step < this.checkoutStep);
            }
        });
        const indicator = document.querySelector('.progress-indicator');
        if(indicator) indicator.style.width = `${((this.checkoutStep - 1) / 2) * 80 + 10}%`;
        const buttonsContainer = document.getElementById('checkout-buttons');
        let buttonsHtml = '';
        if (this.checkoutStep > 1) buttonsHtml += `<button id="checkout-back-btn" class="w-full btn btn-secondary">Voltar</button>`;
        if (this.checkoutStep < 3) buttonsHtml += `<button id="checkout-next-btn" class="w-full btn btn-primary">Continuar</button>`;
        else buttonsHtml += `<button id="place-order-btn" class="w-full btn btn-primary flex items-center justify-center gap-2"><i class="fas fa-lock"></i> Pagar Agora</button>`;
        buttonsContainer.innerHTML = buttonsHtml;
        document.getElementById('checkout-next-btn')?.addEventListener('click', () => this.handleCheckoutNext());
        document.getElementById('checkout-back-btn')?.addEventListener('click', () => this.handleCheckoutBack());
        document.getElementById('place-order-btn')?.addEventListener('click', () => this.placeOrder());
    },

    async handleCheckoutNext() {
        // Validates the current step's form fields before proceeding.
        if (this.validateCurrentStep()) {
            if (this.checkoutStep === 1) {
                // Save shipping info and move to the payment step.
                this.saveShippingInfo();
                this.checkoutStep++;
                this.updateCheckoutView();
                // Initialize the Stripe Payment Element once we are on the payment step.
                await this.initStripePayment();
            } else if (this.checkoutStep === 2) {
                // Move to the review step.
                this.updateReviewDetails();
                this.checkoutStep++;
                this.updateCheckoutView();
            }
        } else {
            this.showToast('Preencha todos os campos obrigatórios.', 'error');
        }
    },

    handleCheckoutBack() { this.checkoutStep--; this.updateCheckoutView(); },

    validateCurrentStep() {
        // The payment step (2) is validated by the Stripe Element itself, not our own form validation.
        if (this.checkoutStep === 2) return true;
        const currentStepInputs = document.getElementById(`checkout-step-${this.checkoutStep}`).querySelectorAll('[required]');
        return this.validateForm(document.getElementById('checkout-form'), currentStepInputs);
    },

    updateCheckoutSummary() {
        const itemListEl = document.getElementById('checkout-item-list');
        const subtotalEl = document.getElementById('checkout-subtotal');
        const totalEl = document.getElementById('checkout-total');
        const discountLineEl = document.getElementById('discount-line');
        const checkoutDiscountEl = document.getElementById('checkout-discount');
        const loyaltyDiscountLineEl = document.getElementById('loyalty-discount-line');
        const checkoutLoyaltyDiscountEl = document.getElementById('checkout-loyalty-discount');

        const itemsHtml = this.cart.map(item => `<div class="flex justify-between items-center"><div class="flex items-center gap-4"><div class="relative"><img src="${item.image}" class="w-16 h-16 rounded-md object-cover" onerror="this.onerror=null;this.src='https://placehold.co/64x64/1a1a1a/e11d48?text=:)';" alt="Imagem" loading="lazy"><span class="absolute -top-2 -right-2 bg-accent text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">${item.quantity}</span></div><div><p class="font-semibold">${item.name}</p></div></div><span class="font-semibold">€${(item.price * item.quantity).toFixed(2)}</span></div>`).join('');

        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        // Coupon discount
        const couponDiscountAmount = subtotal * (this.discount.percentage / 100);
        if (couponDiscountAmount > 0) {
            if (discountLineEl) discountLineEl.style.display = 'flex';
            if (checkoutDiscountEl) checkoutDiscountEl.textContent = `- €${couponDiscountAmount.toFixed(2)}`;
        } else {
            if (discountLineEl) discountLineEl.style.display = 'none';
        }

        // Loyalty points discount
        const loyaltyDiscountAmount = this.loyalty.discountAmount || 0;
        if (loyaltyDiscountAmount > 0) {
            if (loyaltyDiscountLineEl) loyaltyDiscountLineEl.style.display = 'flex';
            if (checkoutLoyaltyDiscountEl) checkoutLoyaltyDiscountEl.textContent = `- €${loyaltyDiscountAmount.toFixed(2)}`;
        } else {
            if (loyaltyDiscountLineEl) loyaltyDiscountLineEl.style.display = 'none';
        }

        const total = subtotal - couponDiscountAmount - loyaltyDiscountAmount;

        if (itemListEl) itemListEl.innerHTML = itemsHtml;
        if (subtotalEl) subtotalEl.textContent = `€${subtotal.toFixed(2)}`;
        if (totalEl) totalEl.textContent = `€${Math.max(0, total).toFixed(2)}`; // Ensure total doesn't go below zero
    },

    populateCheckoutForm() {
        const form = document.getElementById('checkout-form');
        if (form && this.userProfile) {
            form.elements['email'].value = this.user.email || ''; form.elements['firstName'].value = this.userProfile.firstName || '';
            form.elements['lastName'].value = this.userProfile.lastName || ''; form.elements['address'].value = this.userProfile.address?.address || '';
            form.elements['city'].value = this.userProfile.address?.city || ''; form.elements['zip'].value = this.userProfile.address?.zip || '';
        }
    },

    saveShippingInfo() {
        const form = document.getElementById('checkout-form');
        const profileUpdate = { firstName: form.elements.firstName.value, lastName: form.elements.lastName.value, address: { address: form.elements.address.value, city: form.elements.city.value, zip: form.elements.zip.value, } };
        setDoc(doc(this.db, "users", this.user.uid), profileUpdate, { merge: true });
    },

    updateReviewDetails() {
        const form = document.getElementById('checkout-form');
        const shippingEl = document.getElementById('review-shipping-address');
        const paymentEl = document.getElementById('review-payment-method');
        shippingEl.innerHTML = `<p>${form.elements.firstName.value} ${form.elements.lastName.value}</p><p>${form.elements.address.value}</p><p>${form.elements.city.value}, ${form.elements.zip.value}</p><p>${form.elements.email.value}</p>`;
        paymentEl.innerHTML = `<p>Pagamento a ser processado via Stripe (Cartão de Crédito ou MB WAY)</p>`;
    },

    /**
     * Initializes the Stripe Payment Element.
     * It calls a cloud function to create a Payment Intent on the backend,
     * then uses the client secret from the response to mount the Stripe
     * Payment Element to the DOM.
     */
    async initStripePayment() {
        this.showLoading();
        try {
            // Call the cloud function to create a payment intent.
            const createStripePaymentIntent = httpsCallable(this.functions, 'createStripePaymentIntent');
            const payload = {
                cart: this.cart, // Send the full cart for server-side validation
                loyaltyPoints: this.loyalty.pointsUsed,
                discount: this.discount, // Send discount info for server-side validation
                userId: this.user.uid
            };
            console.log("DEBUG: Calling 'createStripePaymentIntent' with payload:", JSON.stringify(payload, null, 2));

            const result = await createStripePaymentIntent(payload);
            const data = result.data;

            if (data.error) {
                 throw new Error(data.error);
            }

            this.paymentIntentClientSecret = data.clientSecret;

            // Define the appearance of the Stripe Element.
            const appearance = {
                theme: 'night',
                labels: 'floating',
                variables: {
                    colorPrimary: '#e11d48',
                    colorBackground: '#1f2937',
                    colorText: '#ffffff',
                    colorDanger: '#ef4444',
                    fontFamily: 'Inter, sans-serif',
                    borderRadius: '0.375rem',
                },
            };

            // Create and mount the Stripe Payment Element.
            this.stripeElements = this.stripe.elements({ appearance, clientSecret: this.paymentIntentClientSecret });
            const paymentElement = this.stripeElements.create("payment");
            paymentElement.mount("#payment-element");

        } catch (error) {
            console.error("--- DEBUG: Stripe Payment Initialization FAILED ---");
            console.error("Error object:", error);
            this.showToast(`Erro ao iniciar pagamento: ${error.message}`, 'error');
        } finally {
            this.hideLoading();
        }
    },

    /**
     * Handles the final payment submission to Stripe.
     * This function is called when the user clicks the "Pay Now" button.
     * It uses stripe.confirmPayment to submit the payment details.
     * Stripe will handle any necessary redirects (e.g., for 3D Secure).
     */
    async placeOrder() {
        if (!this.stripe || !this.stripeElements) {
            this.showToast("O sistema de pagamento não foi inicializado corretamente.", "error");
            return;
        }

        this.showLoading();

        const { error } = await this.stripe.confirmPayment({
            elements: this.stripeElements,
            confirmParams: {
                // The return_url is where the user will be redirected after payment.
                return_url: `${window.location.origin}${window.location.pathname}#/checkout`,
            },
        });

        // This point will only be reached if there is an immediate error.
        // If the payment requires a redirect, the user will be sent away from the page.
        if (error) {
            console.error("--- DEBUG: Stripe confirmPayment FAILED ---");
            console.error("Error Type:", error.type);
            console.error("Error Message:", error.message);
            const messageContainer = document.querySelector("#payment-message");
            messageContainer.textContent = `Erro no pagamento: ${error.message}`;
            messageContainer.classList.remove('hidden');
            this.hideLoading();
        } else {
            this.showToast("A processar o seu pagamento...", "success");
        }
    },

    /**
     * Handles the user's return to the site after a Stripe payment attempt.
     * It retrieves the payment intent status from Stripe and acts accordingly.
     * @param {URLSearchParams} params - The URL parameters from the redirect.
     */
    async handlePostPayment(params) {
        if (!this.stripe) return;
        this.showLoading();

        const clientSecret = params.get('payment_intent_client_secret');
        if (!clientSecret) {
            this.hideLoading();
            return;
        }

        try {
            console.log("--- DEBUG: Handling post-payment redirect. ---");
            const { paymentIntent, error } = await this.stripe.retrievePaymentIntent(clientSecret);

            if (error) {
                console.error("--- DEBUG: Error retrieving Payment Intent ---", error);
                throw new Error(error.message);
            }

            console.log(`--- DEBUG: Retrieved Payment Intent. Status: ${paymentIntent.status} ---`);

            switch (paymentIntent.status) {
                case "succeeded":
                    this.showToast("Pagamento bem-sucedido! A sua encomenda está a ser processada.");

                    // Clear local cart for immediate UI feedback.
                    // The backend webhook is the source of truth for clearing the cart in Firestore.
                    this.cart = [];
                    this.loyalty = { pointsUsed: 0, discountAmount: 0 };
                    this.discount = { code: '', percentage: 0, amount: 0 };
                    this.updateCartCountDisplay(); // Update UI immediately

                    // Set a flag to show a success message on the account page.
                    sessionStorage.setItem('paymentSuccess', 'true');

                    // IMPORTANT: Force a reload of user profile and orders before redirecting
                    // to ensure the new order is visible immediately.
                    console.log("--- DEBUG: Payment succeeded. Reloading user profile and orders before redirect. ---");
                    await this.loadUserProfile();
                    await this.loadOrders();

                    // Redirect the user to their orders page.
                    this.navigateTo('/account?tab=orders');
                    break;
                case "processing":
                    this.showToast("O seu pagamento está a ser processado. Será notificado em breve.", "success");
                    this.navigateTo('/account?tab=orders');
                    break;
                case "requires_payment_method":
                    this.showToast("O pagamento falhou. Por favor, tente outro método de pagamento.", "error");
                    this.navigateTo('/checkout'); // Send back to checkout
                    break;
                default:
                    console.warn(`--- DEBUG: Unhandled payment intent status: ${paymentIntent.status} ---`);
                    this.showToast("Algo correu mal com o pagamento. Por favor, tente novamente.", "error");
                    this.navigateTo('/checkout'); // Send back to checkout
                    break;
            }
        } catch (error) {
            console.error("--- DEBUG: Catastrophic failure in handlePostPayment ---", error);
            this.showToast(`Não foi possível verificar o seu pagamento: ${error.message}`, "error");
        } finally {
            this.hideLoading();
        }
    },

    initExitIntentPopup() {
        const modal = document.getElementById("exit-intent-modal");
        const closeModalBtn = document.getElementById("close-exit-intent-modal");
        const copyCouponBtn = document.getElementById("copy-coupon-btn");
        const showModal = () => {
            if (this.exitIntentShown) return;
            modal.classList.remove("hidden"); modal.classList.add("flex");
            setTimeout(() => { modal.querySelector(".transform").classList.add("opacity-100", "scale-100"); }, 10);
            this.exitIntentShown = true; sessionStorage.setItem('exitIntentShown', 'true');
        };
        const hideModal = () => {
            const content = modal.querySelector(".transform");
            content.classList.remove("opacity-100", "scale-100");
            setTimeout(() => { modal.classList.add("hidden"); modal.classList.remove("flex"); }, 300);
        };
        document.addEventListener("mouseleave", (e) => { if (!sessionStorage.getItem('exitIntentShown') && e.clientY < 50 && this.cart.length > 0) showModal(); });
        closeModalBtn.addEventListener("click", hideModal);
        copyCouponBtn.addEventListener("click", () => { navigator.clipboard.writeText("PRAZER5").then(() => { this.showToast("Cupão 'PRAZER5' copiado!"); hideModal(); }); });
    },

    updateMetaTags(title, description, imageUrl) {
        document.title = title;
        document.querySelector('meta[name="description"]').setAttribute('content', description);
        // Open Graph
        document.querySelector('meta[property="og:title"]').setAttribute('content', title);
        document.querySelector('meta[property="og:description"]').setAttribute('content', description);
        if (imageUrl) document.querySelector('meta[property="og:image"]').setAttribute('content', imageUrl);
        // Twitter
        document.querySelector('meta[property="twitter:title"]').setAttribute('content', title);
        document.querySelector('meta[property="twitter:description"]').setAttribute('content', description);
        if (imageUrl) document.querySelector('meta[property="twitter:image"]').setAttribute('content', imageUrl);
    },

    updateMetaTagsForPage(path, params) {
        const defaultTitle = 'Desire - Liberte as Suas Fantasias';
        const defaultDescription = 'Explore uma coleção de luxo de brinquedos e acessórios para adultos, desenhados para o prazer e bem-estar. Compra segura e discreta na Desire.';

        let title = defaultTitle;
        let description = defaultDescription;
        let imageUrl = 'https://firebasestorage.googleapis.com/v0/b/desire-loja-final.firebasestorage.app/o/og-image.jpg?alt=media&token=example'; // Default OG image

        if (path === '/product-detail') {
            const productId = params.get('id');
            const product = this.products.find(p => p.id === productId);
            if (product) {
                title = `${product.name} | Desire`;
                description = product.description.substring(0, 160); // Truncate for meta description
                imageUrl = product.image;
            }
        } else if (path === '/products') {
            title = 'A Nossa Coleção | Desire';
            description = 'Descubra a nossa curadoria de produtos para ela, para ele e para casais. Prazer e bem-estar com elegância.';
        } else if (path === '/about') {
            title = 'Sobre Nós | Desire';
            description = 'Conheça a história e a missão da Desire. A sua fonte de confiança para bem-estar e prazer íntimo.';
        } else if (path === '/contact') {
            title = 'Contactos | Desire';
            description = 'Entre em contacto com a nossa equipa. Estamos disponíveis para ajudar com as suas questões.';
        }

        this.updateMetaTags(title, description, imageUrl);
    }
};

document.addEventListener('DOMContentLoaded', () => app.init());
window.app = app;
