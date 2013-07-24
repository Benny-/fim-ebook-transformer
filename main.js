#!/usr/bin/env nodejs

var fs				= require('fs');
var http 			= require('http');
var url				= require("url");
var temp			= require('temp');
var step			= require('step');
var request			= require('request');
var embedEpubImages = require('./embedEpubImages');
var child_process	= require('child_process');
var exec 			= require('child_process').exec;

// This program requires the following external programs:
// tidy (for validating html)
// unzip
// zip
// bash

var storiesCached = {};
var tmpDir = temp.mkdirSync("downloaded-epubs");
console.log("Using tmpdir:", tmpDir)

downloadEpub = function(storyID, fn) {
	var dir = tmpDir+'/'+storyID;
	fs.mkdir(dir, function() {
		var destStream = fs.createWriteStream( dir+'/raw.epub' );
		request.get('http://www.fimfiction.net/download_epub.php?story='+storyID).pipe(destStream); // XXX: Carefull, no error checking happening here.
		destStream.once('close', function() {
			console.log("Finished downloading story:", storyID);
			fn();
		});
	});
};

extractEpub = function(storyID, fn) {
	var dir = tmpDir+'/'+storyID;
	var child = exec('unzip '+dir+'/raw.epub -d '+dir+'/extracted', fn);
	child.stdin.end();
};

transformEpub = function(storyID, fn) {
	var dir = tmpDir+'/'+storyID;
	
	step(
		function(){
			var me = this;
			var child = child_process.execFile("./cleanup.bash", [dir+'/extracted'], function(err) {
				if (err && err.code != 1) // The script returns 1 if there are warnings. We will ignore warnings (they are fixed automatically).
					me(err);
				else
					me();
			});
			child.stdin.end();
		},
		function(err){
			if (err) throw err;
			embedEpubImages(dir+'/extracted/', this);
		},
		function(err){
			// The last cleanup is required since the cheerio module in the embedEpubImages module screws up the html files.
			// See https://github.com/MatthewMueller/cheerio/issues/243
			var child = child_process.execFile("./cleanup.bash", [dir+'/extracted'], function(err) {
				if (err && err.code != 1) // The script returns 1 if there are warnings. We will ignore warnings (they are fixed automatically).
					fn(err);
				else
					fn();
			});
			child.stdin.end();
		}
	);
};

packEpub = function(storyID, fn) {
	var dir = tmpDir+'/'+storyID;
	var child = child_process.execFile("./compress.bash", [dir+'/extracted'], fn );
	child.stdin.end();
};

serveEpub = function(req, res, storyID) {
	var dir = tmpDir+'/'+storyID;
	
	fs.readFile(dir+"/processed.epub", function (err, data) {
		if (err)
		{
			console.log(err);
			res.writeHead(500, {'Content-Type': 'text/plain'});
			res.write("Something went terrible wrong when serving the epub");
			res.end();
		}
		else
		{
			res.writeHead(200, { 'Content-Type': 'application/epub+zip ', 'Content-Disposition': 'attachment; filename="'+storyID+'.epub";' });
			
			
			res.write(data);
			res.end();
		}
	});
};

http.createServer(function (req, res) {
	var uri = url.parse(req.url);
	
	if(!uri.query)
	{
		res.writeHead(400, {'Content-Type': 'text/plain'});
		res.write("400, Bad Request: Expecting a query string. Example: /api/story.epub?story=73063")
		res.end();
	}
	else
	{
		var storyID = uri.query.split('=').pop();
		if(!storyID)
		{
			res.writeHead(400, {'Content-Type': 'text/plain'});
			res.write("400, Bad Request: Expecting story id. Example: /api/story.epub?story=73063")
			res.end();
		}
		else if(storiesCached[storyID])
		{
			console.log("Cache hit for story",storyID);
			serveEpub(req, res, storyID);
		}
		else if(storiesCached[storyID] === false)
		{
			// The story is being processed by another request.
			console.log("A 429 occured for story",storyID);
			res.writeHead(429, {'Content-Type': 'text/plain'});
			res.write("429, Too Many Requests. The requested story is being processed. Please try again in a few seconds.");
			res.end();
		}
		else
		{
			storiesCached[storyID] = false; // Indicate the story is being processed.
			step(
				function download() {
					downloadEpub( storyID, this );
			  	},
			  	function extract(err) {
			  		if (err) throw err;
			    	extractEpub( storyID, this );
			  	},
			  	function transform(err) {
			    	if (err) throw err;
			    	transformEpub( storyID, this );
			  	},
			  	function pack(err) {
			  		if (err) throw err;
			    	packEpub( storyID, this );
			  	},
			  	function response(err) {
			  		if(err)
			  		{
			  			console.log(err);
						res.writeHead(500, {'Content-Type': 'text/plain'});
						res.write("500, Internal Server Error. Please try again in a few days.")
						res.end();
			  		}
			  		else
			  		{
			  			console.log("story",storyID,"is succesfully cached");
			  			storiesCached[storyID] = true;
			  			serveEpub(req, res, storyID);
			  		}
			  	}
			);
		}

	}
}).listen(8888);

