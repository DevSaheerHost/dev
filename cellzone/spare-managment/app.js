const $ = s => document.querySelector(s)

const categories = [
  'Samsung',
  'Realme',
  'Xiaomi',
  'Poco',
  'Motorola'
]

async function loadInventoryData() {
  const response = await fetch('./data/inventory.json');

  if (!response.ok) {
    throw new Error(`Failed to load inventory: ${response.status}`);
  }

  const data = await response.json();

  console.log(data);
  renderCategoryBar(data.brands)
  renderHomeCards(data.parts)
}

loadInventoryData();


const renderCategoryBar=(brands)=>{
  console.log(brands['oppo'])
  categorysEl.innerHTML = Object.values(brands).map(brand=>{
    return `<span>${brand.name}</span>`
  }).join('')
}



const renderHomeCards=(parts)=>{
  console.log(parts['oppo'])
  home_cardContainer.innerHTML = Object.values(parts).map(part=>{
    return `<div class='card'>${part.name}</div>`
  }).join('')
}