'use strict';

var browser = require('../util/browser');
var mat4 = require('gl-matrix').mat4;

var drawCollisionDebug = require('./draw_collision_debug');

module.exports = drawSymbols;

function drawSymbols(painter, layer, posMatrix, tile) {
    // No data
    if (!tile.buffers) return;
    var elementGroups = tile.elementGroups[layer.ref || layer.id];
    if (!elementGroups) return;

    var gl = painter.gl;
    gl.disable(gl.STENCIL_TEST);
    if (elementGroups.text.groups.length) {
        drawSymbol(painter, layer, posMatrix, tile, elementGroups.text, 'text', true);
    }
    if (elementGroups.icon.groups.length) {
        drawSymbol(painter, layer, posMatrix, tile, elementGroups.icon, 'icon', elementGroups.sdfIcons);
    }

    drawCollisionDebug(painter, layer, posMatrix, tile);
    gl.enable(gl.STENCIL_TEST);
}

var defaultSizes = {
    icon: 1,
    text: 24
};

function drawSymbol(painter, layer, posMatrix, tile, elementGroups, prefix, sdf) {
    var gl = painter.gl;

    posMatrix = painter.translateMatrix(posMatrix, tile, layer.paint[prefix + '-translate'], layer.paint[prefix + '-translate-anchor']);

    var tr = painter.transform;
    var alignedWithMap = layer.layout[prefix + '-rotation-alignment'] === 'map';
    var skewed = alignedWithMap;
    var exMatrix, s, gammaScale;

    if (skewed) {
        exMatrix = mat4.create();
        s = 4096 / tile.tileSize / Math.pow(2, painter.transform.zoom - tile.zoom);
        gammaScale = 1 / Math.cos(tr._pitch);
    } else {
        exMatrix = mat4.clone(tile.exMatrix);
        s = painter.transform.altitude;
        gammaScale = 1;
    }
    mat4.scale(exMatrix, exMatrix, [s, s, 1]);

    // If layer.paint.size > layer.layout[prefix + '-max-size'] then labels may collide
    var fontSize = layer.paint[prefix + '-size'] || layer.layout[prefix + '-max-size'];
    var fontScale = fontSize / defaultSizes[prefix];
    mat4.scale(exMatrix, exMatrix, [ fontScale, fontScale, 1 ]);

    // calculate how much longer the real world distance is at the top of the screen
    // than at the middle of the screen.
    var topedgelength = Math.sqrt(tr.height * tr.height / 4  * (1 + tr.altitude * tr.altitude));
    var x = tr.height / 2 * Math.tan(tr._pitch);
    var extra = (topedgelength + x) / topedgelength - 1;

    var text = prefix === 'text';
    var shader, buffer, texsize;

    if (!text && !painter.style.sprite.loaded())
        return;

    gl.activeTexture(gl.TEXTURE0);

    if (sdf) {
        shader = painter.sdfShader;
    } else {
        shader = painter.iconShader;
    }

    if (text) {
        painter.glyphAtlas.updateTexture(gl);
        buffer = tile.buffers.glyphVertex;
        texsize = [painter.glyphAtlas.width / 4, painter.glyphAtlas.height / 4];
    } else {
        painter.spriteAtlas.bind(gl, alignedWithMap || painter.options.rotating ||
            painter.options.zooming || fontScale !== 1 || sdf || painter.transform.pitch);
        buffer = tile.buffers.iconVertex;
        texsize = [painter.spriteAtlas.width / 4, painter.spriteAtlas.height / 4];
    }

    gl.switchShader(shader, posMatrix, exMatrix);
    gl.uniform1i(shader.u_texture, 0);
    gl.uniform2fv(shader.u_texsize, texsize);
    gl.uniform1i(shader.u_skewed, skewed);
    gl.uniform1f(shader.u_extra, extra);

    buffer.bind(gl, shader);

    // adjust min/max zooms for variable font sies
    var zoomAdjust = Math.log(fontSize / layer.layout[prefix + '-max-size']) / Math.LN2 || 0;

    gl.uniform1f(shader.u_zoom, (painter.transform.zoom - zoomAdjust) * 10); // current zoom level

    var f = painter.frameHistory.getFadeProperties(300);
    gl.uniform1f(shader.u_fadedist, f.fadedist * 10);
    gl.uniform1f(shader.u_minfadezoom, Math.floor(f.minfadezoom * 10));
    gl.uniform1f(shader.u_maxfadezoom, Math.floor(f.maxfadezoom * 10));
    gl.uniform1f(shader.u_fadezoom, (painter.transform.zoom + f.bump) * 10);

    var begin = elementGroups.groups[0].vertexStartIndex,
        len = elementGroups.groups[0].vertexLength;

    if (sdf) {
        var sdfPx = 8;
        var blurOffset = 1.19;
        var haloOffset = 6;
        var gamma = 0.105 * defaultSizes[prefix] / fontSize / browser.devicePixelRatio;

        gl.uniform1f(shader.u_gamma, gamma * gammaScale);
        gl.uniform4fv(shader.u_color, layer.paint[prefix + '-color']);
        gl.uniform1f(shader.u_buffer, (256 - 64) / 256);
        gl.drawArrays(gl.TRIANGLES, begin, len);

        if (layer.paint[prefix + '-halo-color']) {
            // Draw halo underneath the text.
            gl.uniform1f(shader.u_gamma, (layer.paint[prefix + '-halo-blur'] * blurOffset / fontScale / sdfPx + gamma) * gammaScale);
            gl.uniform4fv(shader.u_color, layer.paint[prefix + '-halo-color']);
            gl.uniform1f(shader.u_buffer, (haloOffset - layer.paint[prefix + '-halo-width'] / fontScale) / sdfPx);
            gl.drawArrays(gl.TRIANGLES, begin, len);
        }
    } else {
        gl.uniform1f(shader.u_opacity, layer.paint['icon-opacity']);
        gl.drawArrays(gl.TRIANGLES, begin, len);
    }
}
