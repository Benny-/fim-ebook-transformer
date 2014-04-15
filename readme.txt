
Fimfiction epub embedder, converter.

This program requires the following external programs in your path:
 - unzip
 - tidy
 - zip
 - ebook-convert (part of calibre)

Known issues:
 - A express request timeouts after 2 minutes with a 200 http code. This happens while converting a huge ebook.
 - A ebook is converted to a .epub and a .mobi regardless if only one of the two was requested.
 - It is slow.
 
This program is written in JavaScript and requires NodeJS.

Installing and downloading dependencies:
npm install

Running:
npm start

