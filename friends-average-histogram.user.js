// ==UserScript==
/* globals jQuery, $, waitForKeyElements */
// @name         Friends Average for Letterboxd
// @namespace    https://github.com/frozenpandaman
// @version      1.3
// @description  Shows a histogram and ratings average for just the users you follow, in addition to the global one.
// @author       eli (frozenpandaman)
// @match        https://letterboxd.com/film/*
// @icon         https://letterboxd.com/favicon.ico
// @grant        none
// ==/UserScript==

// This userscript is a port of the "Friends Average for Letterboxd" Chrome extension by Klaspas, with fixes made by frozenpandaman

const sleep = (ms) =>{
    return new Promise(resolve => setTimeout(resolve, ms));
};

const getHTML = (url) => {
    return fetch(url).then(result => { return result.text() })
};

const getNextPageUrl = (html) => {
    return html.find('.next').closest('a').attr('href') || null;
};

const notloggedIn = () => {
    console.log("Friends Average for Letterboxd extension info:\nThis extension only works if the user is logged in!")
};

const getUserandMovie = async (retries = 5) => {
    // Gets Username and movie from the current site
    const mainNavHTML = $('.main-nav').html();
    if (typeof mainNavHTML == 'undefined') {
        if (retries <= 0) return null;
        await sleep(100);
        return getUserandMovie(retries - 1);
    }

    const movieLink = $('meta[property="og:url"]').attr('content');
    if (!movieLink) return null;

    const urlParts = movieLink.split('film/');
    if (urlParts.length < 2) return null;

    const urlSubParts = urlParts[1].split('/');
    const urlPart = urlSubParts[1];
    const exclude = ['members', 'likes', 'reviews', 'ratings', 'fans', 'lists'];
    if (exclude.includes(urlPart)) return null;

    const movie = movieLink.match('(?<=film\/)(.*?)(?=\/)')[0];
    const userLink = $('a:contains("Profile")').parent().html();
    const user = $(userLink).attr('href');
    if (!user) return null;

    return [user, movie];
};

const getRatingsPage = async (url, selfUser, movie) => {
    const ratingList = [];
    let personCount = 0
    let likeCount = 0;

    while (url && url !== 'undefined') {

        const html = await getHTML(url);

        const tbody = $(html).find('tbody').html();
        if (!tbody) return;

        const rows = extractTableRows($(html));

        for (const row of rows) {
            const result = extractRatings(row, selfUser);
            if (!result) continue

            const [ rating, liked ] = result;
            personCount++;
            if (rating) ratingList.push(rating);
            if (liked) likeCount++;
        }

        const nextPage = getNextPageUrl($(html))
        if (!nextPage) {
            if (ratingList.length === 0 && likeCount === 0) {
                console.log("Friends Average for Letterboxd extension info:\nNo ratings and likes from your friends for this film, so nothing to show.")
                return
            };
            return [ ratingList, personCount, likeCount ]
        }
        url = `https://letterboxd.com${nextPage}`;


    }
};

const extractRatings = ($row, currentUser) => {
    const person = $row.find('.name').attr('href');
    let rating = null;
    if (person === currentUser) return null;

    const liked = $row.find('.icon-liked').length > 0;

    const ratingClass = $row.find('.rating').attr('class') || '';
    const ratingMatch = ratingClass.match(/rated-(\d+)/); // finds string 'rated-' with one or more digits
    if (ratingMatch) {
        rating = Number(ratingMatch[1])
    }

    return [ rating, liked ];
};

const extractTableRows = ($html) => {
    const tbody = $html.find('tbody').html();
    if (!tbody) return [];

    const rowsTable = $('<tbody>' + tbody + '</tbody>');
    const rows = [];

    rowsTable.find('tr').each(function () {
        rows.push($(this));
    });
    return rows;
};

const calculateAverages = (ratingList) => {
    const votes = ratingList.length;
    if (votes === 0) {
        return [ null , votes ];
    }
    const sum = ratingList.reduce((acc, r) => acc + r, 0);
    const avg = sum / (votes * 2);
    return [ avg, votes ];
};

const getRatingCounts = (ratingList) => {
    const counts = Array(10).fill(0); // start with [0,0,...,0]
    for (const r of ratingList) {
        counts[r - 1]++; // rating 1 goes to index 0
    }
    return counts;
};

const getRelativeAndPercentRatings = (ratingCounts, votes) => {
    const maxRating = Math.max(...ratingCounts);
    const relative = ratingCounts.map(count => {
        let height = (count / maxRating) * 44.0;
        return (height < 1 || !isFinite(height)) ? 1 : height;
    });
    const percent = ratingCounts.map(count =>
        votes > 0 ? Math.round((count / votes) * 100) : 0
    );
    return [ relative, percent ];
};

const formatRatingLabels = (ratingCounts, percentRatings) => {
    const stars = ['half-★', '★', '★½', '★★', '★★½','★★★', '★★★½', '★★★★', '★★★★½', '★★★★★'];
    return ratingCounts.map((count, i) => {
        const label = count === 1 ? 'rating' : 'ratings';
        return `${count} ${stars[i]} ${label} (${percentRatings[i]}%)`;
    });
};

const buildHTMLStructure = (hrefHead, hrefLikes, likesText, avg1, dataPopup, ratingCounts, ratingLabels, maxRating) => {
    const stars = ['half-★', '★', '★½', '★★', '★★½', '★★★', '★★★½', '★★★★', '★★★★½', '★★★★★'];
    const starPath = 'M5.065.45c-.22-.61-.95-.59-1.14 0l-.75 2.57H.705c-.73 0-.96.62-.37 1.07l1.99 1.53-.76 2.49c-.22.73.34 1.16.93.71l2-1.53 2 1.53c.59.45 1.15.02.93-.71l-.76-2.49 1.99-1.53c.59-.45.39-1.07-.33-1.07h-2.48z';
    const svgStart = '<svg xmlns="http://www.w3.org/2000/svg" role="graphics-symbol" class="glyph stars -start -rating" width="9" height="9" viewBox="0 0 9 9" aria-label="★"><title>★</title><path transform="translate(0,0)" fill-rule="evenodd" d="' + starPath + '"></path></svg>';
    const svgEnd = '<svg xmlns="http://www.w3.org/2000/svg" role="graphics-symbol" class="glyph stars -end -rating" width="49" height="9" viewBox="0 0 49 9" aria-label="★★★★★"><title>★★★★★</title>' + [0,10,20,30,40].map(x => '<path transform="translate(' + x + ',0)" fill-rule="evenodd" d="' + starPath + '"></path>').join('') + '</svg>';

    let barsHtml = '';
    for (let i = 0; i < 10; i++) {
        const value = maxRating > 0 ? ratingCounts[i] / maxRating : 0;
        barsHtml +=
            '<tr class="column" style="--value:' + value + ';">' +
            '<th scope="row" class="_sr-only">' + stars[i] + '</th>' +
            '<td class="cell">' +
            '<a href="' + hrefHead + '" id="a' + (i+1) + '" class="barcolumn tooltip" data-popup="' + ratingLabels[i].replace(/"/g, '&quot;') + '">' +
            '<span class="_sr-only">' + ratingLabels[i] + '</span>' +
            '<span class="bar"><span class="fill"></span></span>' +
            '</a>' +
            '</td>' +
            '</tr>';
    }

    const str =
        '<section class="section ratings-histogram-chart">' +
        '<header class="section-header -divider -spaced-loose">' +
        '<h2 class="section-heading -omitdivider heading"><a href="' + hrefHead + '">Your Friends</a></h2>' +
        '<aside class="aside"><div class="section-accessories">' +
        '<a href="' + hrefLikes + '" class="accessory">' + likesText + '</a>' +
        '</div></aside>' +
        '</header>' +
        '<div class="rating-histogram"><div class="layout">' +
        svgStart +
        '<table class="chart"><caption class="_sr-only">Rating Distribution</caption>' +
        '<thead class="_sr-only"><tr><th scope="col">Rating</th><th scope="col">Count</th></tr></thead>' +
        '<tbody class="plot">' + barsHtml + '</tbody></table>' +
        svgEnd +
        '<a href="' + hrefHead + '" id="a11" class="averagerating tooltip" data-popup="' + dataPopup + '">' + avg1 + '</a>' +
        '</div></div>' +
        '<div class="twipsy fade above in" id="popup1" style="display:none"><div id="popup2" class="twipsy-arrow" style="left:50%;"></div><div id="aad" class="twipsy-inner"></div></div>' +
        '</section>';

    return $.parseHTML(str);
};
//new
const prepareHTML = (table, user, movie) => {
    const ratingList = table[0];
    const likeCount = table[2];

    const [ avg, votes ] = calculateAverages(ratingList);
    const ratingCounts = getRatingCounts(ratingList);
    const [ , percentRatings ] = getRelativeAndPercentRatings(ratingCounts, votes);
    const ratingLabels = formatRatingLabels(ratingCounts, percentRatings);

    if (debug) {
        console.log('Ratings:', ratingList);
        console.log('Person Count:', table[1]);
        console.log('Votes Count:', votes);
        console.log('Like Count:', likeCount);
        console.log('Average Rating:', avg.toFixed(3));
    }

    const avg1 = avg ? avg.toFixed(1) : '–.–';
    const avg2 = avg ? avg.toFixed(2) : '–.–';

    const hrefHead = `https://letterboxd.com${user}friends/film/${movie}`;
    const hrefLikes = `${hrefHead}/likes/`;
    const dataPopup = `Average of ${avg2} based on ${votes} ${votes === 1 ? 'rating' : 'ratings'}`;
    const likesText = `${likeCount} ${likeCount === 1 ? 'like' : 'likes'}`;
    const maxRating = Math.max(...ratingCounts);

    return buildHTMLStructure(hrefHead, hrefLikes, likesText, avg1, dataPopup, ratingCounts, ratingLabels, maxRating);
};

const injectHTML = (html) => {
    const path = $('.sidebar');
    $(html).appendTo(path);
};

const getWidths = async () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'];
    const widthList = [];
    const popup = $('#popup1');
    const aad = $('#aad');

    popup.css({display: 'block', top: '-3px', left: '-10px'});

    for (const id of ids) {
        const text = $(`#${id}`).data('popup');
        aad.text(text);
        widthList.push(aad.width());
    }

    const extraText = $('#a11').data('popup');
    aad.text(extraText);
    widthList.push(popup.outerWidth());

    popup.css('display', 'none');
    return widthList
};

const main = async () => {
    const userMovie = await getUserandMovie();
    if (!userMovie) {
        notloggedIn();
        return;
    }
    const [user, movie] = userMovie;
    const newURL = `https://letterboxd.com${user}friends/film/${movie}`;
    const results = await getRatingsPage(newURL, user);
    if (!results) return;
    const html = prepareHTML(results, user, movie);
    injectHTML(html);
    const widths = await getWidths();
    return widths
};

let barWidths = null;
var debug = true;
(
    async () => {
    barWidths = await main();
    }
)();

document.addEventListener(
    'mousemove', (e) => {
        if (!barWidths) return;

        const element = $(e.target).closest('#a1,#a2,#a3,#a4,#a5,#a6,#a7,#a8,#a9,#a10,#a11');
        if (!element.length) {
            $('#popup1').attr('style', 'display: none');
            return;
        }

        const id = element.attr('id');
        const text = element.data('popup');
        let position;
        let arrow;

        if (id === 'a11') {
            const offsetParentLeft = $('#a1').offsetParent().offset().left;
            const a11Center = element.offset().left + element.outerWidth() / 2 - offsetParentLeft;
            position = a11Center - Number(barWidths[10]) / 2;
            arrow = 'left: 50%';
        } else {
            const liNr = Number(id.replace('a', ''));
            position = -(Number(barWidths[liNr - 1]) / 2) + (liNr * 16) - 7.5;
            arrow = 'left: 50%';
        }

        $('#popup1').attr('style', 'display: block; top: -3px; left:' + position + 'px;');
        $('#popup2').attr('style', arrow);
        $('#aad').text(text);
    }, false
);