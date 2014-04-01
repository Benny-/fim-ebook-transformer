#!/usr/bin/env node

var fsp             = require('fs-promise');
var http            = require('http');
var url             = require("url");
var temp            = require('temp');
var request         = require('request');
var express         = require('express');
var Q               = require('q');
var path            = require('path')

var fimfic = require('./lib/fimfic');
var ebook = require('./lib/ebook');

var storiesCached = {};
var cacheDir = temp.mkdirSync("downloaded-epubs");
console.log("Using cacheDir:", cacheDir)
Q.longStackSupport = true;
var app = express();
var server = http.createServer(app);

app.set('port', process.env.PORT || 4100);
app.configure('development', function(){
    app.use(express.logger('dev'));
    app.use(express.errorHandler());
})
app.use(express.static('public'))

// This param will only add the extension to the req object.
// The filename itself is NOT used.
//
// The following are thus equal are will return the same response:
// example.com/book/9/download/book.epub
// example.com/book/9/download/the-greatest-equine-who-has-ever-lived.epub
app.param('filename', function(req, res, next, filename) {
    var extension = path.extname(filename)
    if(extension)
    {
        var validExtension = false;
        if(extension == '.epub')
            validExtension = true;
        if(extension == '.mobi')
            validExtension = true;
        
        if(validExtension)
        {
            req.extension = extension;
            next();
        }
        else
        {
            res.status(400);
            res.set('Content-Type', 'text/plain'); // XXX: Throwing a error in next line overrides this.
            next(new Error('The extension '+extension+' is not supported. This server is case sensitive. Contact a administrator if you would like this extension to be supported.'));
        }
    }
    else
    {
        res.status(400);
        res.set('Content-Type', 'text/plain'); // XXX: Throwing a error in next line overrides this.
        next(new Error('No extension.'));
    }
});

app.param('book_id', function(req, res, next, book_id) {
    book_id = parseInt(book_id, 10)
    if( book_id )
    {
        req.book_id = +book_id;
        next();
    }
    else
        next(new Error('Invalid book id.'));
});

var uploadFile = function(res, filename) {
    var deferred = Q.defer();
    res.sendfile( filename, { maxAge:1000*60*60*24*7 }, function(err){
        if(err)
            deferred.reject( err );
        else
            deferred.resolve(filename);
    });
    return deferred.promise;
};

// This function assumes the ebook already exist
var serveBook = function(res, extension, book_dir) {
    return uploadFile(res, path.join(book_dir, "processed"+extension))
}

app.get('/book/:book_id/download/:filename', function(req, res){
    
    // In OPDS world we call them books.
    // In fimfic world we call them stories.
    // But they are just the same things.
    var storyID = req.book_id;
    var book_dir = path.join(cacheDir, String(storyID));
    
    if(storiesCached[storyID])
    {
        // console.log("Cache hit for story",storyID);
        serveBook(res, req.extension, book_dir)
        .catch(function (err) {
            console.error(err);
            if(err.errno == 34)
                res.send(404, 'File does not exist' );
            else
                res.send(500, 'Could not send you the requested file: '+err.message );
            delete storiesCached[storyID];
        })
        .done();
    }
    else if (storiesCached[storyID] === false)
    {
        // The story is being processed by another request.
        res.writeHead(429, {'Content-Type': 'text/plain'});
        res.write("429, Too Many Requests. The story is being processed. Please try again in a few seconds. Huge ebooks with lots of images may take a minute. Contact administrator if error persists.");
        res.end();
    }
    else
    {
        storiesCached[storyID] = false;
        
        fsp.mkdir( book_dir )
        .then( function() { return fimfic.downloadStory(storyID, path.join(book_dir, "from_fimfic.epub"))} )
        .then( function() { return ebook.extract(path.join(book_dir, "from_fimfic.epub"), path.join(book_dir, "tmp_extracted")) } )
        .then( function() { return ebook.tidy(path.join(book_dir, "tmp_extracted")) } ) // Tidy before embedding images.
        .then( function() { return ebook.embedImages(path.join(book_dir, "tmp_extracted")) } )
        .then( function() { return ebook.tidy(path.join(book_dir, "tmp_extracted")) } ) // Tidy after embedding images as the embed image function messes up the html.
        .then( function() { return ebook.pack(path.join(book_dir, "tmp_extracted"), path.join(book_dir, "packed.epub")) } )
        .then( function() {
                var promises = []
                promises.push( ebook.convert(path.join(book_dir, "packed.epub"), path.join(book_dir, "processed.epub"), ['--no-default-epub-cover']) )
                promises.push( ebook.convert(path.join(book_dir, "packed.epub"), path.join(book_dir, "processed.mobi"), []) )
                return Q.all(promises)
             })
        .then( function() {
            storiesCached[storyID] = true;
            console.log("Story",storyID,"succesfully cached")
            
            serveBook(res, req.extension, book_dir)
            .catch(function (err) {
                console.error(err);
                if(err.errno == 34)
                    res.send(404, 'File does not exist' );
                else
                    res.send(500, 'Could not send you the requested file: '+err.message );
            })
            .done()
        })
        .catch(function (err) {
            console.error(err);
            res.send(500, 'Could not process the file: '+err.message );
            delete storiesCached[storyID];
        })
        .done()
    }
    
});

server.listen(app.get('port'), function(){
    console.log('Express server listening on port ' + app.get('port'));
});

