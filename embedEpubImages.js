#!/usr/bin/env nodejs

var cheerio = require('cheerio');
var request = require('request');
var fs		= require('fs');
var glob	= require("glob");
var step	= require('step');

// The step module allows synchronization points of parallel tasks.

function guessExtension(url)
{
    if(url.match(/.gif/i))
        return 'gif';
    
    if(url.match(/.jpg/i))
        return 'jpeg';
    
    if(url.match(/.jpeg/i))
        return 'jpeg';
    
    if(url.match(/.png/i))
        return 'png';
    
    return 'png'; // We simply return png and hope the client will figure out the correct image type.
}

var imageCounter = 0;

// Expects a path to a html file.
// Any externally linked images inside file will be downloaded and put in a the `imageDir` directory
embedHTMLImages = function(htmlFile, imageDir, fn) {
	fs.readFile(htmlFile, function(err, data) {
		if(err)
			fn(err)
		else
		{
			var $ = cheerio.load(data);
		    step(
		    	function processTags() {
		    		var imageTags = $('img');
		    		
		    		if(imageTags.length)
		    		{
						for(var i = 0; i<imageTags.length; i++)
						{
						    var imageTag = imageTags[i];
						    var imageUrl = imageTag.attribs.src;
						    var newImageId = imageCounter++;
						    var destStream = fs.createWriteStream(imageDir+'/'+newImageId+'.'+guessExtension(imageUrl) );
						    imageTag.attribs.src = 'images/'+newImageId+'.'+guessExtension(imageUrl);
						    
						    // This inmediatly executing closure is required so multiple different request-closures don't share the same variables.
						    // And so we can pass in this.parallel() for the step module
							(function(imageTag, imageUrl, newImageId, destStream, callback) {
								request.get(imageUrl).pipe(destStream); // XXX: Carefull, no error checking happening here.
								destStream.once('close', function() {
									callback();
								});
							}) (imageTag, imageUrl, newImageId, destStream, this.parallel() );
						}
				    }
				    else
				    {
				    	this();
				    }
		      	},
		      	function finish(err) {
					fs.writeFile(htmlFile, $.html(), fn);
		      	}
		    );
		}
	})
};

// Read all html files in `dir` and downloads all the external images and puts them in a new image/ directory inside `dir`
embedEpubImages = function(dir, fn) {
	imageDir = dir+"images";
	fs.mkdir(imageDir, function() {
		glob(dir+"*.html", function (er, files) {
		    step(
		    	function processFiles() {
					files.forEach(function(file) {
						embedHTMLImages(file, imageDir, this.parallel());
					}, this);
		        
		      	},
		      	function finish(err) {
		        	fn(err);
		      	}
		    );
		})
	});
};

module.exports = embedEpubImages

