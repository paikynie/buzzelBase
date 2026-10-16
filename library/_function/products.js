const fs = require('fs');
const path = require('path');

const productPath = path.join(__dirname, '../../library/database/products.json');

function loadProducts() {
    try {
        if (!fs.existsSync(productPath)) {
            fs.writeFileSync(productPath, JSON.stringify({}, null, 2));
        }
        const data = fs.readFileSync(productPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        return {};
    }
}

function saveProducts(products) {
    fs.writeFileSync(productPath, JSON.stringify(products, null, 2));
}

function getProductByKey(key, groupId) {
    const products = loadProducts();
    if (!products[groupId]) return null;
    return products[groupId].find(p => p.key === key);
}

function addCatalog(title, desc, key, price, groupId) {
    const products = loadProducts();
    if (!products[groupId]) products[groupId] = [];
    if (products[groupId].find(p => p.key === key)) return false;
    products[groupId].push({ 
        title, 
        desc, 
        key, 
        price,
        stock: 0,
        sold: 0,
        items: []
    });
    saveProducts(products);
    return true;
}

function addStock(key, email, password, note, groupId) {
    const products = loadProducts();
    if (!products[groupId]) return false;
    const index = products[groupId].findIndex(p => p.key === key);
    if (index === -1) return false;
    
    products[groupId][index].items.push({
        email,
        password,
        note,
        sold: false,
        soldAt: null
    });
    products[groupId][index].stock++;
    saveProducts(products);
    return true;
}

function buyProduct(key, amount, groupId) {
    const products = loadProducts();
    if (!products[groupId]) return null;
    const index = products[groupId].findIndex(p => p.key === key);
    if (index === -1) return null;
    
    const availableItems = products[groupId][index].items.filter(item => !item.sold);
    if (availableItems.length < amount) return null;
    
    const boughtItems = [];
    for (let i = 0; i < amount; i++) {
        const item = availableItems[i];
        item.sold = true;
        item.soldAt = Date.now();
        boughtItems.push({
            email: item.email,
            password: item.password,
            note: item.note
        });
    }
    
    products[groupId][index].stock -= amount;
    products[groupId][index].sold += amount;
    saveProducts(products);
    
    return boughtItems;
}

function getAllCatalog(groupId) {
    const products = loadProducts();
    return products[groupId] || [];
}

function deleteCatalog(key, groupId) {
    const products = loadProducts();
    if (!products[groupId]) return false;
    const index = products[groupId].findIndex(p => p.key === key);
    if (index === -1) return false;
    products[groupId].splice(index, 1);
    saveProducts(products);
    return true;
}

module.exports = { 
    addCatalog,
    addStock, 
    buyProduct,
    getAllCatalog,
    getProductByKey,
    deleteCatalog
};