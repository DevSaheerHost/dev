const $=s=>document.querySelector(s)
const $$=s=>document.querySelectorAll(s)



let dishes = [];

const loadDishes = async () => {

  const res = await fetch(
    'https://www.themealdb.com/api/json/v1/1/search.php?s='
  );

  const data = await res.json();

  dishes = data.meals.map((meal, index) => ({
    id: Number(meal.idMeal),
    name: meal.strMeal,
    price: [180, 160, 220, 140, 190][index % 5],
    category: meal.strCategory,
    image: meal.strMealThumb
  }));

  renderCategories(dishes)
  autoScrollDish(dishes, 5);
  renderDishes(dishes);
};

loadDishes();


// dish auto scroll

const autoScrollDish = (dishes, limit = 3) => {
  const container = $('#welcome_scroll_dish');

  const selected = dishes.slice(0, limit);

  // 3 copies
  const items = [...selected, ...selected, ...selected];

  items.forEach(d => {
    const card = document.createElement('div')
    card.classList.add('card');
    card.style.backgroundImage=`url(${d.image})`
   // const image = document.createElement('img');
    
    card.innerHTML=`
    <div class='text-bg'>
      <p>${d.name} : ₹${d.price}</p>
    </div>
    `
    //image.src = d.image;
    card.draggable = false;
    //card.appendChild(image)
    container.appendChild(card);
  });
};



const container = $('#welcome_scroll_dish');

let autoScrolling = true;
let resumeTimer;

const setWidth = () => container.scrollWidth / 3;


// Start in the middle copy
requestAnimationFrame(() => {
  container.scrollLeft = setWidth();
});


const loopScroll = () => {
  if (autoScrolling) {
    container.scrollLeft += 0.5;
  }

  const width = setWidth();

  // Re-center when reaching the end
  if (container.scrollLeft >= width * 2) {
    container.scrollLeft -= width;
  }

  // Re-center when manually scrolling backwards
  if (container.scrollLeft <= 0) {
    container.scrollLeft += width;
  }

  requestAnimationFrame(loopScroll);
};

loopScroll();



const renderDishes = (dishes) => {
  const productList=$('#product_list')
  productList.innerHTML = dishes.map(d => `
      <div class="card product-item">
        <img src="${d.image}" alt="${d.name}" />
        
        <div class="details">
          <p class="name">${d.name}</p>
          <p class="price">₹${d.price}</p>
        </div>
      </div>

  `).join('');
};

renderDishes(dishes);





const getCategories = (dishes) => {
  return [...new Set(dishes.map(d => d.category))];
};


const renderCategories = (dishes) => {
  const container = $('.categories');

  const categories = [
    'All',
    ...new Set(dishes.map(d => d.category))
  ];

  container.innerHTML = categories.map((category, index) => `
    <span
      class="category ${index === 0 ? 'active' : ''}"
      data-category="${category}"
    >
      ${category}
    </span>
  `).join('');
};




$('.categories').addEventListener('click', (e) => {
  const category = e.target.closest('.category');

  if (!category) return;

  $$('.category').forEach(c => {
    c.classList.remove('active');
  });

  category.classList.add('active');

  const selected = category.dataset.category;

  if (selected === 'All') {
    renderDishes(dishes);
    return;
  }

  const filtered = dishes.filter(
    dish => dish.category === selected
  );

  renderDishes(filtered);
});





// ########## NAVIGATION CONTROL ######### //

const showPage = (pageId, direction = 'forward') => {
  document.querySelectorAll('.page').forEach(page => {
    page.classList.add('hidden');
    page.classList.remove('slide-forward', 'slide-back');
  });

  const page = document.getElementById(pageId);

  page.classList.remove('hidden');

  // Force animation restart
  void page.offsetWidth;

  page.classList.add(
    direction === 'back'
      ? 'slide-back'
      : 'slide-forward'
  );
};


const navigateTo = (pageId) => {
  showPage(pageId, 'forward');

  history.pushState(
    { page: pageId },
    '',
    location.href
  );
};


window.addEventListener('popstate', (event) => {
  const pageId = event.state?.page || 'welcome';

  showPage(pageId, 'back');
});

// ######### NAVIGATION CONTROL END ########## //