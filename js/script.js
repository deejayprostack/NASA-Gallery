// Find the controls and display areas on the page.
const startInput = document.getElementById('startDate');
const endInput = document.getElementById('endDate');
const getImagesButton = document.getElementById('getImagesBtn');
const gallery = document.getElementById('gallery');
const spaceFact = document.getElementById('spaceFact');
const modal = document.getElementById('imageModal');
const modalMedia = document.getElementById('modalMedia');
const modalTitle = document.getElementById('modalTitle');
const modalDate = document.getElementById('modalDate');
const modalExplanation = document.getElementById('modalExplanation');
const modalClose = document.getElementById('modalClose');

// NASA's public demo key works for APOD. Swap in your own key from api.nasa.gov if you hit the demo limit.
const API_KEY = 'DEMO_KEY';
const APOD_FEED = 'https://science.nasa.gov/feed/apod-basic/';
const APOD_NS = 'https://science.nasa.gov/apod/';
const CONTENT_NS = 'http://purl.org/rss/1.0/modules/content/';

// Fun facts shown at random each time the page loads.
const spaceFacts = [
  'A day on Venus is longer than a year on Venus. It takes about 243 Earth days to rotate once, but only about 225 Earth days to orbit the Sun.',
  'Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.',
  'Neutron stars are so dense that a teaspoon of their material would weigh about a billion tons.',
  'The footprints left by Apollo astronauts on the Moon can last millions of years because the Moon has no wind or rain to erase them.',
  'Jupiter’s Great Red Spot is a storm wider than Earth that has been raging for at least 150 years.',
  'Saturn is less dense than water, so it would float if you could find a bathtub big enough.',
  'Olympus Mons on Mars is the tallest volcano in the solar system, standing about three times higher than Mount Everest.',
  'The International Space Station travels at about 17,500 miles per hour and orbits Earth roughly every 90 minutes.',
  'One year on Neptune lasts about 165 Earth years.',
  'The Milky Way and the Andromeda Galaxy are on course to meet in about 4.5 billion years.'
];

let lastFocusedElement = null;

// dateRange.js limits the pickers to NASA's archive, from June 16, 1995 through today.
setupDateInputs(startInput, endInput);
showRandomFact();

getImagesButton.addEventListener('click', fetchSpaceImages);
modalClose.addEventListener('click', closeModal);

modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    closeModal();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !modal.hasAttribute('hidden')) {
    closeModal();
  }
});

function showRandomFact() {
  const index = Math.floor(Math.random() * spaceFacts.length);
  spaceFact.textContent = spaceFacts[index];
}

async function fetchSpaceImages() {
  const startDate = startInput.value;
  const endDate = endInput.value;

  if (!startDate || !endDate) {
    showGalleryMessage('Choose both a start date and an end date.');
    return;
  }

  if (startDate > endDate) {
    showGalleryMessage('The end date needs to be on or after the start date.');
    return;
  }

  showGalleryMessage('🔄 Loading space photos…');
  getImagesButton.disabled = true;

  try {
    let items = [];
    let apiError = null;

    try {
      items = await fetchFromNasaApi(startDate, endDate);
    } catch (error) {
      apiError = error;
    }

    // NASA's API sometimes sends its logo instead of the real photo. The APOD feed has the picture.
    const needsFeed = items.length === 0 || items.some(isPlaceholder);
    if (needsFeed) {
      try {
        const feedByDate = await fetchApodFeed();
        if (items.length) {
          items = items.map((item) => repairItem(item, feedByDate[item.date]));
        } else {
          items = itemsFromFeed(feedByDate, startDate, endDate);
        }
      } catch (feedError) {
        if (!items.length) {
          throw apiError || feedError;
        }
      }
    }

    const pictures = items.filter((item) => !isPlaceholder(item));

    if (!pictures.length) {
      throw apiError || new Error('Those dates are outside the pictures NASA is currently sending. Try a range from the last 30 days.');
    }

    displayGallery(pictures);
  } catch (error) {
    showGalleryMessage(error.message || 'We could not reach NASA. Check your connection and try again.');
  } finally {
    getImagesButton.disabled = false;
  }
}

async function fetchFromNasaApi(startDate, endDate) {
  // thumbs=true asks NASA for a still image when the entry is a video.
  const url = `https://api.nasa.gov/planetary/apod?api_key=${API_KEY}&start_date=${startDate}&end_date=${endDate}&thumbs=true`;
  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok || data.error || data.code) {
    const message = (data.error && data.error.message) || data.msg || 'NASA could not return photos for that date range.';
    throw new Error(message);
  }

  return Array.isArray(data) ? data : [data];
}

async function fetchApodFeed() {
  const response = await fetch(APOD_FEED);
  if (!response.ok) {
    throw new Error('NASA’s picture feed did not load.');
  }

  const xmlText = await response.text();
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  const feedByDate = {};

  xml.querySelectorAll('item').forEach((item) => {
    const entry = readFeedItem(item);
    if (entry.date) {
      feedByDate[entry.date] = entry;
    }
  });

  return feedByDate;
}

function readFeedItem(item) {
  const pubDate = textOf(item, 'pubDate');
  const encoded = namespacedText(item, CONTENT_NS, 'encoded');
  const media = readPrimaryMedia(encoded);
  const hdurl = namespacedText(item, APOD_NS, 'hdurl');
  const imageUrl = media.imageUrl || (isImageFile(hdurl) ? hdurl : '');

  return {
    date: toIsoDate(pubDate),
    title: textOf(item, 'title'),
    explanation: plainText(namespacedText(item, APOD_NS, 'explanation')),
    page_url: namespacedText(item, APOD_NS, 'url') || textOf(item, 'link'),
    image_url: imageUrl,
    thumbnail_url: isImageFile(hdurl) ? hdurl : imageUrl,
    video_url: media.videoUrl,
    media_type: media.videoUrl ? 'video' : 'image'
  };
}

function readPrimaryMedia(html) {
  if (!html) {
    return { imageUrl: '', videoUrl: '' };
  }

  const doc = new DOMParser().parseFromString(html, 'text/html');
  const image = doc.querySelector('img');
  const source = doc.querySelector('video source');
  const iframe = doc.querySelector('iframe');
  let videoUrl = '';

  if (source && source.getAttribute('src')) {
    videoUrl = source.getAttribute('src');
  } else if (iframe && iframe.getAttribute('src')) {
    videoUrl = iframe.getAttribute('src');
    if (videoUrl.startsWith('//')) {
      videoUrl = `https:${videoUrl}`;
    }
  }

  return {
    imageUrl: image ? image.getAttribute('src') : '',
    videoUrl
  };
}

function itemsFromFeed(feedByDate, startDate, endDate) {
  return Object.values(feedByDate)
    .filter((entry) => entry.date >= startDate && entry.date <= endDate)
    .map((entry) => repairItem({ date: entry.date, title: '', explanation: '', media_type: 'image' }, entry));
}

function repairItem(item, extra) {
  if (!extra || !isPlaceholder(item)) {
    return item;
  }

  const mediaType = extra.media_type || item.media_type || 'image';

  return {
    date: item.date || extra.date,
    title: extra.title || item.title,
    explanation: extra.explanation || item.explanation,
    media_type: mediaType,
    url: mediaType === 'video' ? (extra.video_url || extra.page_url) : (extra.image_url || item.url),
    hdurl: extra.image_url || item.hdurl,
    thumbnail_url: extra.thumbnail_url || extra.image_url || item.thumbnail_url,
    video_url: extra.video_url || '',
    page_url: extra.page_url || ''
  };
}

function isPlaceholder(item) {
  const address = `${item.url || ''} ${item.hdurl || ''}`;
  return !item.url || item.title === 'NASA Science' || address.includes('nasa-logo');
}

function displayGallery(items) {
  gallery.innerHTML = '';

  const summary = document.createElement('p');
  summary.className = 'gallery-summary';
  const label = items.length === 1 ? 'picture' : 'pictures';
  summary.textContent = `Showing ${items.length} astronomy ${label} from NASA.`;
  gallery.appendChild(summary);

  // Show the newest photo first.
  const newestFirst = items.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  newestFirst.forEach((item) => {
    gallery.appendChild(createGalleryCard(item));
  });
}

function createGalleryCard(item) {
  const card = document.createElement('article');
  card.className = 'gallery-item';
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `View details for ${item.title}`);

  const frame = document.createElement('div');
  frame.className = 'image-frame';

  const previewUrl = getPreviewImage(item);
  if (previewUrl) {
    const image = document.createElement('img');
    image.src = previewUrl;
    image.alt = item.title;
    frame.appendChild(image);
  } else {
    const fallback = document.createElement('div');
    fallback.className = 'video-fallback';
    fallback.textContent = '▶';
    frame.appendChild(fallback);
  }

  if (item.media_type === 'video') {
    const badge = document.createElement('span');
    badge.className = 'media-badge';
    badge.textContent = 'Video';
    frame.appendChild(badge);
  }

  const title = document.createElement('h2');
  title.className = 'card-title';
  title.textContent = item.title;

  const date = document.createElement('p');
  date.className = 'card-date';
  date.textContent = formatDate(item.date);

  card.append(frame, title, date);

  const open = () => openModal(item);
  card.addEventListener('click', open);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });

  return card;
}

function getPreviewImage(item) {
  if (item.media_type === 'video') {
    return sizedImage(item.thumbnail_url || item.hdurl || '', 800);
  }

  return sizedImage(item.url || item.hdurl || '', 800);
}

function sizedImage(url, width) {
  if (!url || !isImageFile(url)) {
    return '';
  }

  if (url.includes('/dynamicimage/')) {
    const base = url.split('?')[0];
    return `${base}?w=${width}&fit=clip`;
  }

  return url;
}

function openModal(item) {
  lastFocusedElement = document.activeElement;
  modalTitle.textContent = item.title || 'NASA Astronomy Picture';
  modalDate.textContent = formatDate(item.date);
  modalExplanation.textContent = item.explanation || 'NASA did not include an explanation for this entry.';
  modalMedia.innerHTML = '';

  if (item.media_type === 'video') {
    const videoUrl = item.video_url || item.url;
    const player = createVideoPlayer(videoUrl, item.title);
    if (player) {
      modalMedia.appendChild(player);
    } else if (item.thumbnail_url || item.hdurl) {
      modalMedia.appendChild(createModalImage(item.hdurl || item.thumbnail_url, item.title));
    }

    const watchUrl = item.page_url || item.url;
    if (watchUrl) {
      const link = document.createElement('a');
      link.className = 'video-link';
      link.href = watchUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Watch this video on NASA’s page';
      modalMedia.appendChild(link);
    }
  } else {
    modalMedia.appendChild(createModalImage(item.hdurl || item.url, item.title));
  }

  modal.hidden = false;
  document.body.classList.add('modal-open');
  modalClose.focus();
}

function createModalImage(src, alt) {
  const image = document.createElement('img');
  image.src = sizedImage(src, 1600) || src;
  image.alt = alt;
  return image;
}

function createVideoPlayer(url, title) {
  const embedUrl = getEmbedUrl(url);
  if (embedUrl) {
    const frame = document.createElement('iframe');
    frame.src = embedUrl;
    frame.title = title;
    frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen';
    frame.allowFullscreen = true;
    return frame;
  }

  if (url && /\.(mp4|webm)(\?|$)/i.test(url)) {
    const video = document.createElement('video');
    video.controls = true;
    video.playsInline = true;
    video.src = url;
    video.setAttribute('aria-label', title);
    return video;
  }

  return null;
}

function getEmbedUrl(url) {
  if (!url) {
    return '';
  }

  try {
    const parsed = new URL(url, 'https://www.youtube.com');
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
    }

    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      if (parsed.pathname.startsWith('/embed/')) {
        const id = parsed.pathname.split('/')[2];
        return id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
      }
      if (parsed.pathname.startsWith('/shorts/')) {
        const id = parsed.pathname.split('/')[2];
        return id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
      }
      const id = parsed.searchParams.get('v');
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : '';
    }

    if (host === 'player.vimeo.com' || host === 'vimeo.com') {
      const id = parsed.pathname.split('/').filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : '';
    }
  } catch (error) {
    return '';
  }

  return '';
}

function closeModal() {
  modal.hidden = true;
  modalMedia.innerHTML = '';
  document.body.classList.remove('modal-open');

  if (lastFocusedElement) {
    lastFocusedElement.focus();
  }
}

function showGalleryMessage(text) {
  gallery.innerHTML = '';
  const message = document.createElement('p');
  message.className = 'gallery-message';
  message.textContent = text;
  gallery.appendChild(message);
}

function formatDate(dateString) {
  if (!dateString) {
    return '';
  }

  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function toIsoDate(pubDate) {
  const date = new Date(pubDate);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function textOf(parent, tagName) {
  const node = parent.getElementsByTagName(tagName)[0];
  return node ? node.textContent.trim() : '';
}

function namespacedText(parent, namespace, tagName) {
  const node = parent.getElementsByTagNameNS(namespace, tagName)[0];
  return node ? node.textContent.trim() : '';
}

function plainText(html) {
  const spaced = (html || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|strong|b|em)>/gi, ' ');
  const doc = new DOMParser().parseFromString(spaced, 'text/html');
  return doc.body.textContent
    .replace(/\s+/g, ' ')
    .replace(/^Explanation:\s*/i, '')
    .trim();
}

function isImageFile(url) {
  return Boolean(url) && !/\.(mp4|webm)(\?|$)/i.test(url) && !/youtube|vimeo/i.test(url);
}
