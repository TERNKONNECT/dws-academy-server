terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region  = var.aws_region
  profile = "ternkonnect" # Matching your frontend profile
}

# Securely generate a random password for the database
resource "random_password" "db_password" {
  length           = 16
  special          = true
  # Exclude characters that often break connection strings
  override_special = "_-!" 
}

# Create a security group to allow Lambda/Local access to the database
resource "aws_security_group" "rds_sg" {
  name        = "${var.project_name}-rds-sg"
  description = "Allow inbound PostgreSQL traffic"

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Publicly accessible (Required since Lambda is not in a VPC)
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-rds-sg"
  }
}

# Provision the RDS PostgreSQL instance
resource "aws_db_instance" "postgres" {
  identifier           = "${var.project_name}-db"
  allocated_storage    = 20
  engine               = "postgres"
  engine_version       = "16" 
  instance_class       = "db.t4g.micro" # Free Tier eligible in most regions
  db_name              = var.db_name
  username             = var.db_username
  password             = random_password.db_password.result
  
  vpc_security_group_ids = [aws_security_group.rds_sg.id]
  
  publicly_accessible = true
  skip_final_snapshot = true # Allows you to destroy the DB quickly without waiting for a backup

  tags = {
    Name = "${var.project_name}-postgres"
  }
}
