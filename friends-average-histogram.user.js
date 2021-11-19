// ==UserScript==
/* globals jQuery, $, waitForKeyElements */
// @name         Friends Average for Letterboxd
// @namespace    https://github.com/frozenpandaman
// @version      0.1 (0.9.1)
// @description  Shows a histogram and ratings average for just the users you follow, in addition to the global one.
// @author       eli / frozenpandaman
// @match        https://letterboxd.com/film/*
// @icon         https://letterboxd.com/favicon.ico

// @grant        none
// ==/UserScript==

// This userscript is a port of the "Friends Average for Letterboxd" Chrome extension by Klaspas

'use strict';
window.addEventListener('load', function (e) {
    var element = e.srcElement;
    let single = $(element).attr('id')
    let double = $(element).parent().attr('id')
    if (ids.includes(double) || ids.includes(single)) {
        var position;
        var arrow;
        var text;

        if (single == 'a11') {
            text = $(element).data('popup');
            let li_nr = 11;
            // let width = $('#aad').width();
            position = - (Number(widths[li_nr - 1]) * 3 / 4) + 190;
            arrow = "left: 145px"
        }

        else {
            text = $(element).text();
            if (text == '') {
                text = $(element).parent().text();
            }
            let li_nr = Number(single.replace('a', ''));
            if (isNaN(li_nr)) {
                li_nr = Number(double.replace('a', ''));
            }
            // let width = $('#aad').width();
            position = - (Number(widths[li_nr - 1]) / 2) + (li_nr * 16) - 7.5;
            arrow = "left: 50%";

        }

        $('#popup1').attr('style', 'display: block; top: -3px; left:' + position + 'px;')
        $('#popup2').attr('style', arrow)
        $('#aad').text(text);
    }
    else {
        $('#popup1').attr('style', 'display: none');
    }
}, false);

let sleep = function (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
};

let getHTML = function (url) {
    return fetch(url).then(result => { return result.text() })
};


let getinfo = async () => {
    // Gets Username and movie from the current site
    var main_nav = $('.main-nav').html();
    if (typeof main_nav == 'undefined') {
        await sleep(100);
        getinfo();
    }
    else {
        let movie_link = $('meta[property="og:url"]').attr('content');
        let url_part = movie_link.split('film/')[1].split('/')[1];
        let exclude = ['members', 'likes', 'reviews', 'ratings', 'fans', 'lists'];
        if (!exclude.includes(url_part)) {
            let movie = movie_link.match('(?<=film\/)(.*?)(?=\/)')[0];
            let user_link = $('a:contains("Profile")').parent().html();
            let user = $(user_link).attr('href');
            if (typeof user !== 'undefined') {
                return [user, movie];
            }
        }
        return null;
    }
}

let getContent = async (url, user_movie) => {
    var rating_list = [];
    var person_count = 0
    var like_count = 0;
    while (true) {
        if (url !== 'undefined') {
            let html = getHTML(url);
            let table = await html.then(function (html) {
                let tbody = $(html).find('tbody').html();
                if (typeof tbody !== 'undefined') {
                    let table = '<tbody>' + tbody + '</tbody>';
                    $(table).find('tr').each(function () {
                        let person = $(this).find(".name").attr('href');
                        if (person !== user_movie[0]) {
                            let rating = $(this).find(".rating").attr('class')
                            person_count += 1;
                            let like = $(this).find('.icon-liked').html();
                            if (typeof like !== 'undefined') {
                                like_count += 1;
                            }
                            if (typeof rating !== 'undefined') {
                                rating = rating.split('-')[1];
                                rating_list.push(Number(rating));
                            }
                        }
                    });

                }
                let next_page_loc = $(html).find('.next').parent().html();
                let next_page = $(next_page_loc).attr('href');
                return [next_page, rating_list, person_count, like_count];

            })
            if (typeof table[0] == 'undefined') {
                if (table[1].length == 0 & table[3] == 0) {
                    break;
                }
                else {
                    prepContent(table, user_movie);
                    return true;
                }
            }
            else {
                url = 'https://letterboxd.com' + table[0];
            }
        }
    }
};

let prepContent = function (table, user_movie) {
    var rating_list = table[1];
    var votes = rating_list.length;
    var avg;
    var avg_1;
    var avg_2;
    var rating;
    console.log('Ratings:', rating_list);
    console.log('Person Count:', table[2]);
    console.log('Like Count:', table[3]);
    if (votes == 0) {
        avg_1 = '–.–';
        avg_2 = '–.–';
    }
    else {
        let sum = 0;
        for (var r of rating_list) {
            sum += r;
        }
        avg = sum / (votes * 2);
        avg_1 = avg.toFixed(1);
        avg_2 = avg.toFixed(2);
    }

    console.log('Average Rating:', avg_1);
    var href_head = user_movie[0] + 'friends/film/' + user_movie[1];
    var href_likes = user_movie[0] + 'friends/film/' + user_movie[1] + '/likes/';
    if (votes == 1) {
        rating = 'rating';
    }
    else {
        rating = 'ratings';
    }
    var data_popup = 'Average of ' + avg_2 + ' based on ' + votes + ' ' + rating;
    let rating_count = [];
    for (let i = 1; i < 11; i++) {
        let count = 0
        for (rating of rating_list) {
            if (rating == i) {
                count += 1;
            }
        }
        rating_count.push(count);
    }

    let max_rating = Math.max(...rating_count);
    let relative_rating = [];
    let percent_rating = [];

    for (rating of rating_count) {
        let hight = (rating / max_rating) * 44.0;
        if (hight < 1 || hight == Number.POSITIVE_INFINITY || isNaN(hight)) {
            hight = 1;
        }
        relative_rating.push(hight);
        let perc = Math.round((rating / votes) * 100);
        percent_rating.push(perc);
    }

    let rat = [];
    var stars = ['half-★', '★', '★½', '★★', '★★½', '★★★', '★★★½', '★★★★', '★★★★½', '★★★★★'];
    for (let i = 1; i < 11; i++) {
        if (rating_count[i - 1] == 1) {
            rating = 'rating';
        }
        else {
            rating = 'ratings';
        }
        let r_n = rating_count[i - 1] + ' ' + stars[i - 1] + ' ' + rating + ' (' + percent_rating[i - 1] + '%)';
        rat.push(r_n);
    };


    let str1 = '<section class="section ratings-histogram-chart"><h2 class="section-heading"><a href="" id="aaa" title="">Ratings from Friends</a></h2><a href="" id="aab" class="all-link more-link"></a><span class="average-rating" itemprop="aggregateRating" itemscope="" itemtype="http://schema.org/AggregateRating"><a href="" id="a11" class="tooltip display-rating -highlight" data-popup =""></a></span><div class="rating-histogram clear rating-histogram-exploded">        <span class="rating-green rating-green-tiny rating-1">            <span class="rating rated-2">★</span>        </span>        <ul>';
    let str2 = '<li id="li1" class="rating-histogram-bar" style="width: 15px; left: 0px"> <a href="" id="a1" class="ir tooltip"</a> </li><li id="li2" class="rating-histogram-bar" style="width: 15px; left: 16px"><a href="" id="a2" class="ir tooltip"></a></li><li id="li3" class="rating-histogram-bar" style="width: 15px; left: 32px"><a href="" id="a3" class="ir tooltip"></a></li><li id="li4" class="rating-histogram-bar" style="width: 15px; left: 48px"><a href="" id="a4" class="ir tooltip"></a></li><li id="li5" class="rating-histogram-bar" style="width: 15px; left: 64px"><a href="" id="a5" class="ir tooltip"></a></li><li id="li6" class="rating-histogram-bar" style="width: 15px; left: 80px"><a href="" id="a6" class="ir tooltip"></a></li><li id="li7" class="rating-histogram-bar" style="width: 15px; left: 96px"><a href="" id="a7" class="ir tooltip"></a></li><li id="li8" class="rating-histogram-bar" style="width: 15px; left: 112px"><a href="" id="a8" class="ir tooltip"></a></li><li id="li9" class="rating-histogram-bar" style="width: 15px; left: 128px"><a href="" id="a9" class="ir tooltip"></a></li><li id="li10" class="rating-histogram-bar" style="width: 15px; left: 144px"><a href="" id="a10" class="ir tooltip"></a></li></ul><span class="rating-green rating-green-tiny rating-5"><span class="rating rated-10">★★★★★</span></span></div>';
    let str3 = '<div class="twipsy fade above in" id="popup1", style="display: none"> <div id="popup2" class="twipsy-arrow" style="left: 50%;"></div> <div id = "aad" class="twipsy-inner"></div> </div> </section>';
    let str = str1 + str2 + str3;

    var html = $.parseHTML(str)
    $(html).find('#aaa').attr('href', href_head);
    $(html).find('#aab').attr('href', href_likes);
    if (table[3] == 1) {
        $(html).find('#aab').text('1 like');
    }
    else {
        $(html).find('#aab').text(table[3] + ' likes');
    }
    $(html).find('#a11').attr('href', href_head);
    $(html).find('#a11').attr('data-popup', data_popup);
    $(html).find('#a11').text(avg_1);

    for (let i = 1; i < 11; i++) {
        let id = '#a' + i
        let i_str = '<i id = "i' + i + '" style=" height: ' + relative_rating[i - 1] + 'px;"></i>'
        $(html).find(id).attr('href', href_head);
        $(html).find(id).text(rat[i - 1]);
        $(html).find(id).append($.parseHTML(i_str));
    }

    injectContent(html);
    return true;
}

let injectContent = function (html) {

    let path = $('.sidebar');
    $(html).appendTo(path);
    console.log('Injected')
    return true;
}

let getWidths = async () => {
    var ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10'];
    var widths = []
    $('#popup1').attr('style', 'display: block; top: -3px; left: -10px;')

    for (var a of ids) {
        let id = '#' + a;
        let text = $(id).text();
        $('#aad').text(text);
        let width = $('#aad').width();
        widths.push(width)
    }

    let text = $('#a11').data('popup')
    $('#aad').text(text);
    let width = $('#aad').width();
    widths.push(width);

    $('#popup1').attr('style', 'display: none')
    return widths
}

let main = async () => {
    var user_movie = await getinfo();
    if (user_movie !== null && typeof user_movie !== 'undefined') {
        var user = user_movie[0];
        var movie = user_movie[1];
        let newURL = 'https://letterboxd.com' + user + 'friends/film/' + movie;
        getContent(newURL, user_movie);
        widths = await getWidths();
        console.log('221', widths)
        return widths
    }
}

var widths = main();
var ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11'];
