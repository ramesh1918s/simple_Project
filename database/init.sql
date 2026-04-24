CREATE DATABASE tasksdb;

USE tasksdb;

CREATE TABLE tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255)
);

INSERT INTO tasks (title) VALUES ('Learn Docker');
