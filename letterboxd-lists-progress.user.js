// ==UserScript==
/* globals jQuery, $, waitForKeyElements */
// @name         Letterboxd Lists Progress
// @namespace    https://github.com/frozenpandaman
// @version      0.1 (0.2)
// @description  Displays liat progress underneath cover art.
// @author       eli / frozenpandaman
// @match        https://letterboxd.com/*
// @icon         https://letterboxd.com/favicon.ico
// @grant        GM_addStyle
// ==/UserScript==

// This userscript is a port of the "Letterboxd Lists Progress" Chrome extension by Lucas Franco

GM_addStyle ( `
.list-link {
	margin-bottom: 23px !important;
}
.wide-sidebar .list-link {
	margin-bottom: 31px !important;
}
.list-link.lf-no-margin, .wide-sidebar .list-link.lf-no-margin, .wide-sidebar .lf-progress-container, .lf-progress-container {
	margin-bottom: 0 !important;
}
.lf-progress-container {
	height: 20px;
	background: #14181c;
	border-top: 1px solid #456;
	position: relative !important;
	border: 1px solid #456 !important;
	border-radius: 3px;
	margin-top: 3px !important;
	padding: 4px !important;
	box-sizing: border-box;
	background-color: #303840;
}
.lf-progress-container:active:after, .lf-progress-container:hover:after {
	display: none !important;
}
.lf-progress-bar {
	position: absolute;
	left: 0;
	top: 0;
	height: 18px;
	background: #40bcf4;
}
.lf-description {
	position: relative;
	color: #fff;
	font-size: 11px;
}
.lf-prgress-counter {
	position: absolute;
	right: 0;
	top: 0;
}
` );

'use strict';
window.addEventListener('load', function (e) {
	if ($("#add-new-button").length > 0) {
		passByLists();
		setInterval(function() {
			passByLists();
		}, 500);
	}
}, false);

let passByLists = function () {
	$(".list-link:not(.lf-checked), .list-link-stacked:not(.lf-checked)").each(function() {
		var $self = $(this),
			link = $self.attr("href"),
			$where = $("<div></div>");

		$self.addClass("lf-checked");
		$where.load(link + " .progress-panel", function() {
			if ($where.find(".progress-percentage").text().length < 1) {
				return false;
			}

			let $progress = $("<div class='lf-progress-container list-link'>"
							+ "<div class='lf-progress-bar'></div>"
							+ "<div class='lf-description'>"
								+ "You've watched <span class='lf-progress-count'></span> of <span class='lf-progress-total'></span>"
								+ "<div class='lf-prgress-counter'>"
									+ "<span class='lf-progress-percentage'></span>%"
								+ "</div>"
							+ "</div>"
						+ "</div>");
			$progress.find(".lf-progress-percentage").text($where.find(".progress-percentage").text());
			$progress.find(".lf-progress-bar").css({"width": $where.find(".progress-percentage").text() + "%"});
			$progress.find(".lf-progress-count").text($where.find(".js-progress-count").text());
			$progress.find(".lf-progress-total").text($where.find(".progress-count").text().match(/of ([0-9]+)/)[1]);

			$self.after($progress).addClass("lf-no-margin");
		});
	});
}
