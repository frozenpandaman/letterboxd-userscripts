// ==UserScript==
// @name         Letterboxd Top 2000
// @namespace    https://github.com/frozenpandaman
// @version      0.1 (2.1)
// @description  Shows the ranking of each of the top 2000 highest-rated & most popular movies.
// @author       eli / frozenpandaman
// @match        https://letterboxd.com/film/*
// @icon         https://letterboxd.com/favicon.ico
// @grant        none
// ==/UserScript==

// This userscript is a port of the "Letterboxd Top 2000" Chrome extension by koenhagen

'use strict';
window.addEventListener('load', function (e) {
    let id = parseInt(document.getElementsByClassName("film-poster")[0].getAttribute("data-film-id"))

    getData(1, id, 'https://raw.githubusercontent.com/koenhagen/lb-top-2000/main/top_2000_highest_rated.json')
    getData(2, id, 'https://raw.githubusercontent.com/koenhagen/lb-top-2000/main/top_2000_most_popular.json')
}, false);

let getData = function (type, id, json_link) {
	fetch(json_link)
		.then(res => res.json())
		.then((out) => {
			out.find(function(item, i){
				if (item.Date === id){
					if (type == 1) {
						 addCrown(i+1);
                    }
					else {
						addFire(i+1);
                    }
				}
			});
	});
}

let addCrown = function (ranking) {
	var li_crown = document.createElement("li");
	var a_crown = document.createElement("a");
	li_crown.className = "stat"
	a_crown.setAttribute("href", "/koenie/list/letterboxd-top-2000-narrative-feature-films/");
	a_crown.className = "has-icon icon-top250 icon-16 tooltip";
	let span = document.createElement("span");
	span.className = "icon";
	a_crown.appendChild(span);
	a_crown.appendChild(document.createTextNode(ranking));
	li_crown.appendChild(a_crown);

	new MutationObserver(function(mutations) {
		for (const {addedNodes} of mutations) {
		  for (const node of addedNodes) {
			if (node.nodeType !== Node.ELEMENT_NODE) {
			  continue;
			}
			var ul = document.getElementsByClassName("film-stats")[0];
			if (ul.getElementsByTagName("li").length > 1) {
				const top250 = document.getElementsByClassName("filmstat-top250");
				if(top250.length == 0){
					ul.appendChild(li_crown);
				}
				this.disconnect();
			}
		  }
		}
	}).observe(document, {attributes: false, childList: true, characterData: false, subtree:true});
}

let addFire = function (ranking) {
	var li_fire = document.createElement("li");
	li_fire.className = "stat"
	var a_fire = document.createElement("a");
	a_fire.setAttribute("href", "/koenie/list/letterboxd-top-2000-most-popular-narrative/");
	a_fire.style.fontSize = ".92307692rem"
	let fire = document.createElement("img");
	fire.src = "https://raw.githubusercontent.com/frozenpandaman/letterboxd-userscripts/master/top-2000-flame.svg";
	fire.setAttribute("height", "12");
	fire.setAttribute("width", "12");
	fire.style.float = "left"
	fire.style.paddingTop = "1px"
	fire.style.marginLeft = "-1px"
	fire.style.marginRight = "3px"
	a_fire.appendChild(fire);
	a_fire.appendChild(document.createTextNode(ranking));
	li_fire.appendChild(a_fire);


	new MutationObserver(function(mutations) {
		for (const {addedNodes} of mutations) {
		  for (const node of addedNodes) {
			if (node.nodeType !== Node.ELEMENT_NODE) {
			  continue;
			}
			var ul = document.getElementsByClassName("film-stats")[0];
			if (ul.getElementsByTagName("li").length > 1) {
				ul.appendChild(li_fire);
				this.disconnect();
			}
		  }
		}
	}).observe(document, {attributes: false, childList: true, characterData: false, subtree:true});
}

