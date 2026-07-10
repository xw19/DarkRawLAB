#version 300 es

// Fullscreen-triangle vertex shader. `position` covers clip space; we derive
// texture coords from it and flip Y because image data is top-left origin
// while GL's framebuffer is bottom-left origin.

in vec2 position;
out vec2 v_uv;

void main() {
  vec2 uv = position * 0.5 + 0.5;
  v_uv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = vec4(position, 0.0, 1.0);
}
