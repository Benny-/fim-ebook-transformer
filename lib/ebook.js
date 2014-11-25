var cheerio         = require('cheerio');
var request         = require('request');
var fs              = require('fs');
var fsp             = require('fs-promise');
var Q               = require('q');
var child_process   = require('child_process');
var path            = require('path')
var url             = require('url')

var guessExtension = function(url) {
    if(url.match(/.gif/i))
        return 'gif';
    
    if(url.match(/.jpg/i))
        return 'jpeg';
    
    if(url.match(/.jpeg/i))
        return 'jpeg';
    
    if(url.match(/.png/i))
        return 'png';
    
    return 'png'; // XXX: We simply return png and hope the client will figure out the correct image type.
}

var imageCounter = 0;
var imageDirName = 'images';

var embedImages_single_file = function(htmlFile, outputHtmlFile, imageDir, existingImages) {
    // console.log("embedImages_single_file()", htmlFile, outputHtmlFile, imageDir, existingImages )
    
    return fsp.readFile(htmlFile)
    .then(function(data) {
        var $ = cheerio.load(data);
        var imageTags = $('img');
        var promises = [];
        for(var i = 0; i<imageTags.length; i++)
        {
            // This inmediatly executing closure is required so multiple different request-closures don't share the same variables.
            (function() {
                var deferred = Q.defer();
                var imageTag = imageTags[i];
                var imageUrl = imageTag.attribs.src;
                var newImageId = 'fim-ebook-transformer-id-' + imageCounter++;
                
                var alreadyExist = false;
                if(existingImages) {
                    existingImages.forEach(function(existingImage) {
                        if ( (imageDirName+'/'+existingImage) == imageUrl)
                            alreadyExist = true
                    })
                }
                
                if(!alreadyExist)
                {
                    imageUrl = url.resolve("https://www.fimfiction.net/", imageUrl)
                    
                    var validImage = false
                    
                    var destStream = fs.createWriteStream( path.join(imageDir, String(newImageId) + '.' + guessExtension(imageUrl)) );
                    request.get(imageUrl)
                        .on('response', function(response) {
                            if (response.statusCode == 200)
                                validImage = true
                        })
                        .on('error', function(err) {
                            validImage = false
                            destStream.end(); // Not sure if destStream will close on error. Meh, we close it anyway here.
                            deferred.reject(new Error(err));
                        })
                        .pipe(destStream);
                
                    destStream.once('close', function() {
                        if(validImage)
                        {
                            imageTag.attribs.src = imageDirName+'/'+newImageId+'.'+guessExtension(imageUrl);
                            deferred.resolve(imageTag.attribs.src);
                        }
                        else
                        {
                            console.log("Invalid response for image-url: ",imageUrl)
                            imageTag.attribs.src = imageUrl
                            deferred.reject(new Error("Invalid response for image-url: " + imageUrl));
                        }
                    });
                    
                    destStream.once('error', function(err) {
                        validImage = false
                        deferred.reject(new Error(err));
                    });
                    
                    promises.push(deferred.promise);
                }
            }) ();
        }
        
        return Q.allSettled(promises)
                .then( function() { return fsp.writeFile(outputHtmlFile, $.html()) } );
    });
}

module.exports.embedImages_html = function(htmlFile, outputHtmlFile) {
    var imageDir = path.join(path.dirname(htmlFile), imageDirName);
    return embedImages_single_file(htmlFile, outputHtmlFile, imageDir);
}

var runProgram = function(programName, args, options) {
    // console.log('runProgram()', programName, args, options)
    
    var deferred = Q.defer();
    
    var child = child_process.spawn(programName, args, options );
    child.stdin.end();
    var stderr = ""
    
    child.stdout.on('data', function(block)
    {
        // console.log(String(block))
        // Throw it away to make sure child process does not block on output write.
    });
    
    child.stderr.on('data', function(block)
    {
        stderr = stderr + String(block)
        // console.log(String(block))
        // Throw it away to make sure child process does not block on output write.
    });
    
    child.on('close', function (code) {
        if (code !== 0)
            deferred.reject(new Error(programName + " returned error code " + code + '\n\n' + stderr));
        else
            deferred.resolve();
    });
    
    return deferred.promise;
}

module.exports.convert = function(filename, filenameDestination, options) {
    return runProgram('ebook-convert', [filename, filenameDestination].concat(options) ); // options go last for ebook-convert
};

