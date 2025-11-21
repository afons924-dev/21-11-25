const admin = require("firebase-admin");
const fs = require("fs");
const path = require("path");
const cheerio = require("cheerio");

// Simple in-memory cache
const cache = new Map();

// Load the base HTML template
const templatePath = path.join(__dirname, './index.html');
const HTML_TEMPLATE = fs.readFileSync(templatePath).toString();

// Initialize Firestore
let db;

/**
 * Initializes the renderer with a Firestore instance.
 * @param {object} firestoreDb The Firestore database instance.
 */
function init(firestoreDb) {
    db = firestoreDb;
}

/**
 * Renders the meta tags for a given page using Cheerio.
 * @param {cheerio.CheerioAPI} $ The Cheerio instance.
 * @param {object} meta The metadata to render.
 */
function renderMeta($, meta) {
    $('title').text(meta.title);
    $('meta[name="description"]').attr("content", meta.description);
    $('link[rel="canonical"]').attr("href", meta.canonical);

    // Open Graph / Facebook
    $('meta[property="og:title"]').attr("content", meta.title);
    $('meta[property="og:description"]').attr("content", meta.description);
    $('meta[property="og:url"]').attr("content", meta.canonical);
    if (meta.image) {
        $('meta[property="og:image"]').attr("content", meta.image);
    }

    // Twitter
    $('meta[property="twitter:title"]').attr("content", meta.title);
    $('meta[property="twitter:description"]').attr("content", meta.description);
    if (meta.image) {
        $('meta[property="twitter:image"]').attr("content", meta.image);
    }
}

/**
 * Fetches a single product from Firestore.
 * @param {string} productId The ID of the product to fetch.
 * @returns {object|null} The product data or null if not found.
 */
async function getProduct(productId) {
    const docRef = db.collection("products").doc(productId);
    const doc = await docRef.get();
    if (!doc.exists) {
        return null;
    }
    return { id: doc.id, ...doc.data() };
}

/**
 * Renders the product detail page.
 * @param {cheerio.CheerioAPI} $ The Cheerio instance.
 * @param {object} product The product data to render.
 */
async function renderProductPage($, product) {
    // Fetch the product-detail.html template
    const productTemplatePath = path.join(__dirname, 'templates/product-detail.html');
    const productTemplate = fs.readFileSync(productTemplatePath).toString();

    // Simple template replacement
    // This is a basic example. A more robust solution would use a templating engine.
    const imageList = (product.images && product.images.length > 0) ? product.images : [product.image || 'https://placehold.co/800x800/1a1a1a/e11d48?text=Indisponível'];
    const thumbnailsHtml = imageList.map((img, index) => `
        <img src="${img}" alt="Thumbnail ${index + 1} for ${product.name}" class="w-20 h-20 object-cover rounded-md cursor-pointer border-2 border-transparent hover:border-accent focus:border-accent transition-all duration-200" data-index="${index}">
    `).join('');

    const renderedProduct = productTemplate
        .replace(/\{\{product.name\}\}/g, product.name)
        .replace(/\{\{product.description\}\}/g, product.description)
        .replace(/\{\{product.price\}\}/g, product.price.toFixed(2))
        .replace(/\{\{product.image\}\}/g, imageList[0])
        .replace(/\{\{product.thumbnails\}\}/g, thumbnailsHtml);

    $('#app-root').html(renderedProduct);

    renderMeta($, {
        title: `${product.name} | Desire`,
        description: product.description.substring(0, 160),
        canonical: `https://desire.pt/product-detail?id=${product.id}`,
        image: (product.images && product.images[0]) || product.image
    });
}

/**
 * Main rendering function.
 * @param {object} req The request object.
 * @param {object} res The response object.
 */
async function render(req, res) {
    const url = req.path;
    const now = Date.now();
    const CACHE_DURATION = 60000; // 1 minute

    // Check cache first
    if (cache.has(url) && (now - cache.get(url).timestamp < CACHE_DURATION)) {
        console.log(`[Cache HIT] for ${url}`);
        return res.status(200).send(cache.get(url).html);
    }
    console.log(`[Cache MISS] for ${url}`);

    try {
        const $ = cheerio.load(HTML_TEMPLATE);

        // Basic routing
        if (url.startsWith('/product-detail')) {
            const productId = new URLSearchParams(req.url.split('?')[1]).get('id');
            if (productId) {
                const product = await getProduct(productId);
                if (product) {
                    await renderProductPage($, product);
                } else {
                    // Product not found, render 404
                    const notFoundTemplate = fs.readFileSync(path.join(__dirname, 'templates/404.html')).toString();
                    $('#app-root').html(notFoundTemplate);
                    res.status(404);
                }
            }
        } else {
            // For now, other pages will be rendered client-side.
            // We can add more routes here later (e.g., /products, /about).
            renderMeta($, {
                title: 'Desire - Liberte as Suas Fantasias',
                description: 'Explore uma coleção de luxo de brinquedos e acessórios para adultos, desenhados para o prazer e bem-estar. Compra segura e discreta na Desire.',
                canonical: 'https://desire.pt/'
            });
        }

        const finalHtml = $.html();

        // Save to cache
        cache.set(url, { html: finalHtml, timestamp: now });

        return res.status(200).send(finalHtml);

    } catch (error) {
        console.error("SSR Error:", error);
        return res.status(500).send("An error occurred during server-side rendering.");
    }
}

module.exports = { init, render };
